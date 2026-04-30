#!/usr/bin/env node

/**
 * @lab94/frenchie CLI
 *
 * Usage:
 *   npx @lab94/frenchie install                    — auto-detect + install (project-level only)
 *   npx @lab94/frenchie install --agent <name>     — install for a specific agent
 *   npx @lab94/frenchie install --all              — install for every supported agent
 *   npx @lab94/frenchie install --global           — allow writes to $HOME configs
 *   npx @lab94/frenchie install --api-key fr_...   — seed the MCP config with an API key (re-runs reuse the existing key automatically)
 *   npx @lab94/frenchie list                       — list bundled skills
 *   npx @lab94/frenchie setup                      — print MCP setup instructions
 *   npx @lab94/frenchie update                     — re-run installers for already-installed agents
 *   npx @lab94/frenchie mcp                        — run the bundled stdio MCP server (used by MCP clients)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { execFileSync } = require("child_process");

const SKILLS_DIR = path.join(__dirname, "..", "skills");
const PROJECT_ROOT = process.cwd();
const HOME = os.homedir();

// Pin the package spec in every MCP config we write. Unpinned `@lab94/frenchie`
// lets npx serve whatever is cached — users who upgraded the installer still
// spawned the older cached server, which defeated 0.3.0's stdio-metadata
// contract. Reading version directly from our own manifest keeps pin and
// package in lockstep without a separate config step.
const PACKAGE_SPEC = `@lab94/frenchie@${require("../package.json").version}`;

const argv = process.argv.slice(2);
const command = argv[0];
const rawFlags = argv.slice(1);

// ─── Flag parsing ─────────────────────────────────────────────────────────────

function hasFlag(flag) {
  return rawFlags.includes(flag);
}

function flagValue(flag) {
  const idx = rawFlags.indexOf(flag);
  if (idx === -1) return null;
  return rawFlags[idx + 1] ?? null;
}

const DRY_RUN = hasFlag("--dry-run");
const INSTALL_ALL = hasFlag("--all");
const GLOBAL_MODE = hasFlag("--global");
const AGENT_FLAG = flagValue("--agent");
const CLI_API_KEY = flagValue("--api-key");

// ─── Agent registry ───────────────────────────────────────────────────────────

function homePath(...segments) {
  return path.join(HOME, ...segments);
}

function projectPath(...segments) {
  return path.join(PROJECT_ROOT, ...segments);
}

function claudeDesktopGlobalPath() {
  if (process.platform === "darwin") {
    return homePath("Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, "Claude", "claude_desktop_config.json");
    return homePath("AppData", "Roaming", "Claude", "claude_desktop_config.json");
  }
  return homePath(".config", "Claude", "claude_desktop_config.json");
}

function antigravityGlobalPath() {
  return homePath(".gemini", "antigravity", "mcp_config.json");
}

const DOCS_BASE = "https://getfrenchie.dev/docs/tools";

const AGENTS_TIER_A = {
  claude: {
    name: "Claude Code",
    detect: () => fs.existsSync(projectPath(".claude")),
    installSkill: installClaudeSkill,
    mcp: {
      project: { path: projectPath(".mcp.json"), format: "json-mcp-servers" },
      global: { path: homePath(".claude.json"), format: "json-mcp-servers" }
    },
    hint: {
      restart: "Restart Claude Code.",
      invocations: ["/ocr TOR.pdf", "/transcribe meeting.mp3", "/frenchie-status"],
      docsUrl: `${DOCS_BASE}/claude-code`,
      notes: []
    }
  },
  cursor: {
    name: "Cursor",
    detect: () =>
      fs.existsSync(projectPath(".cursorrules")) || fs.existsSync(projectPath(".cursor")),
    installSkill: installCursorSkill,
    mcp: {
      project: { path: projectPath(".cursor", "mcp.json"), format: "json-mcp-servers" },
      global: { path: homePath(".cursor", "mcp.json"), format: "json-mcp-servers" }
    },
    hint: {
      restart: "Restart Cursor (or reload MCP settings).",
      invocations: ["Use Frenchie to OCR TOR.pdf"],
      docsUrl: `${DOCS_BASE}/cursor`,
      notes: [
        "First-time install can land with the MCP server disabled in Cursor Settings.",
        "If you see \"MCP server does not exist: frenchie\", open Settings → MCP and toggle `frenchie` on.",
        "https://getfrenchie.dev/docs/troubleshooting#mcp-server-does-not-exist-cursor"
      ]
    }
  },
  codex: {
    name: "Codex",
    detect: () =>
      fs.existsSync(projectPath("AGENTS.md")) ||
      fs.existsSync(projectPath(".agents")) ||
      fs.existsSync(projectPath(".codex")),
    installSkill: installCodexSkill,
    mcp: {
      project: { path: projectPath(".codex", "config.toml"), format: "toml-codex" },
      global: { path: homePath(".codex", "config.toml"), format: "toml-codex" }
    },
    hint: {
      restart: "Restart Codex.",
      invocations: ["/frenchie TOR.pdf", "@frenchie ocr TOR.pdf", "OCR TOR.pdf with Frenchie"],
      docsUrl: `${DOCS_BASE}/codex`,
      notes: [
        "The MCP panel labels frenchie as \"Auth unsupported\" — that's informational, not an error. stdio env-var auth works fine."
      ]
    }
  },
  antigravity: {
    name: "Antigravity",
    // Antigravity is a user-level/desktop tool with no project marker — opt-in only via
    // `--agent antigravity --global`, same pattern as claude-desktop.
    detect: () => false,
    installSkill: installAntigravitySkill,
    mcp: {
      project: null,
      global: { path: antigravityGlobalPath(), format: "json-mcp-servers" }
    },
    hint: {
      restart: "Reload Antigravity's MCP server list.",
      invocations: ["/frenchie TOR.pdf"],
      docsUrl: `${DOCS_BASE}/antigravity`,
      notes: [
        "Antigravity invokes MCP servers by server name, not skill name — /ocr and @frenchie won't route."
      ]
    }
  },
  windsurf: {
    name: "Windsurf",
    detect: () => fs.existsSync(projectPath(".windsurfrules")),
    installSkill: installWindsurfSkill,
    mcp: {
      project: null,
      global: { path: homePath(".codeium", "windsurf", "mcp_config.json"), format: "json-mcp-servers" }
    },
    hint: {
      restart: "Reload Windsurf.",
      invocations: ["OCR TOR.pdf via Frenchie"],
      docsUrl: `${DOCS_BASE}/windsurf`,
      notes: []
    }
  },
  vscode: {
    name: "VS Code (GitHub Copilot)",
    detect: () => fs.existsSync(projectPath(".vscode")),
    installSkill: installVSCodeSkill,
    mcp: {
      project: { path: projectPath(".vscode", "mcp.json"), format: "json-vscode" },
      // User settings.json is a dense multi-key file — safer to print a snippet
      // and let the user paste it into Settings (JSON) themselves than to merge
      // programmatically and risk mangling other editor config.
      global: {
        path: "VS Code → Settings (JSON) → top-level \"mcp\" key",
        format: "json-vscode",
        printOnly: true
      }
    },
    hint: {
      restart: "Reload the VS Code window so Copilot picks up the new MCP server.",
      invocations: ["/frenchie TOR.pdf"],
      docsUrl: `${DOCS_BASE}/vscode`,
      notes: []
    }
  },
  gemini: {
    name: "Gemini CLI",
    detect: () => fs.existsSync(projectPath("GEMINI.md")),
    installSkill: installGeminiSkill,
    mcp: {
      project: { path: projectPath(".gemini", "settings.json"), format: "json-mcp-servers" },
      global: { path: homePath(".gemini", "settings.json"), format: "json-mcp-servers" }
    },
    hint: {
      restart: "Restart Gemini CLI.",
      invocations: ["OCR TOR.pdf with Frenchie"],
      docsUrl: `${DOCS_BASE}/gemini-cli`,
      notes: []
    }
  },
  zed: {
    name: "Zed",
    detect: () => fs.existsSync(projectPath(".rules")),
    installSkill: installZedSkill,
    mcp: {
      project: null,
      global: { path: homePath(".config", "zed", "settings.json"), format: "json-zed-context-servers" }
    },
    hint: {
      restart: "Reload the Zed assistant panel.",
      invocations: ["OCR TOR.pdf via Frenchie"],
      docsUrl: `${DOCS_BASE}/zed`,
      notes: []
    }
  },
  "claude-desktop": {
    name: "Claude Desktop",
    detect: () => false, // desktop app — never auto-detect from project files
    installSkill: null, // no project skill files
    mcp: {
      project: null,
      global: { path: claudeDesktopGlobalPath(), format: "json-mcp-servers" }
    },
    hint: {
      restart: "Fully quit and reopen Claude Desktop (Cmd+Q on macOS).",
      invocations: ["Use Frenchie to OCR TOR.pdf"],
      docsUrl: `${DOCS_BASE}/claude-desktop`,
      notes: []
    }
  }
};

const TIER_B = {
  amp: { name: "Amp", docs: "https://ampcode.com/manual#mcp" },
  cline: { name: "Cline", docs: "https://docs.cline.bot/mcp/configuring-mcp-servers" },
  continue: { name: "Continue", docs: "https://docs.continue.dev/customize/deep-dives/mcp" },
  junie: { name: "JetBrains Junie", docs: "https://www.jetbrains.com/help/junie/model-context-protocol-mcp.html" },
  roo: { name: "Roo Code", docs: "https://docs.roocode.com/features/mcp/using-mcp-in-roo" },
  kilo: { name: "Kilo Code", docs: "https://kilo.ai/docs/features/mcp/using-mcp-in-kilo-code" },
  "amazon-q": {
    name: "Amazon Q",
    docs: "https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html"
  },
  opencode: { name: "opencode", docs: "https://opencode.ai/docs/mcp-servers/" }
};

// Generic fallback target — the `.agent/skills/frenchie/` tree for any MCP-aware agent
// that doesn't have its own first-class installer.
const GENERIC_AGENT = {
  name: "Agent Skills (.agent/skills)",
  skillDir: projectPath(".agent", "skills"),
  detect: () => fs.existsSync(projectPath(".agent"))
};

// Detection order matters only for output logging. All detected agents are independent.
const AUTO_DETECT_ORDER = ["claude", "cursor", "codex", "antigravity", "windsurf", "vscode", "gemini", "zed"];

// ─── Skill helpers ────────────────────────────────────────────────────────────

function getSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((name) => {
    const skillPath = path.join(SKILLS_DIR, name);
    return (
      fs.statSync(skillPath).isDirectory() &&
      fs.existsSync(path.join(skillPath, "SKILL.md"))
    );
  });
}

function getSkillDescription(skillName) {
  const skillMd = path.join(SKILLS_DIR, skillName, "SKILL.md");
  if (!fs.existsSync(skillMd)) return "";
  const content = fs.readFileSync(skillMd, "utf8");
  const match = content.match(/^description:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readSkillBody(skillName) {
  const skillMd = path.join(SKILLS_DIR, skillName, "SKILL.md");
  if (!fs.existsSync(skillMd)) return "";
  const content = fs.readFileSync(skillMd, "utf8");
  // Strip frontmatter for inline embedding into AGENTS.md-style files
  return content.replace(/^---[\s\S]*?---\n*/, "").trim();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SKILL_MARKER_START = "<!-- frenchie-skill -->";
const SKILL_MARKER_END = "<!-- /frenchie-skill -->";

function upsertBlock(filePath, content) {
  let existing = "";
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, "utf8");
  }

  const block = `${SKILL_MARKER_START}\n${content}\n${SKILL_MARKER_END}`;

  if (existing.includes(SKILL_MARKER_START)) {
    let updated;
    if (existing.includes(SKILL_MARKER_END)) {
      const pattern = new RegExp(
        escapeRegExp(SKILL_MARKER_START) + "[\\s\\S]*?" + escapeRegExp(SKILL_MARKER_END),
        "g"
      );
      updated = existing.replace(pattern, block);
    } else {
      // Legacy: no end marker — replace from start marker to EOF
      const idx = existing.indexOf(SKILL_MARKER_START);
      updated = existing.substring(0, idx) + block;
    }
    fs.writeFileSync(filePath, updated);
    logWrite(filePath, "updated");
    return;
  }

  const separator = existing.length > 0 ? "\n\n" : "";
  fs.writeFileSync(filePath, existing + separator + block);
  logWrite(filePath, "installed");
}

function logWrite(filePath, kind) {
  const rel = path.relative(PROJECT_ROOT, filePath);
  const label = rel.startsWith("..") ? filePath : rel;
  const sigil = kind === "updated" ? "~" : "+";
  console.log(`  ${sigil} ${label} (${kind})`);
}

// ─── Skill installers (per-agent) ─────────────────────────────────────────────

function installClaudeSkill(dryRun) {
  const commandsSrc = path.join(SKILLS_DIR, "frenchie", "commands");
  const commandsDir = projectPath(".claude", "commands");
  const instructionsFile = projectPath(".claude", "instructions.md");

  if (dryRun) {
    console.log("  [plan] copy .claude/commands/*.md");
    console.log("  [plan] upsert .claude/instructions.md");
    return;
  }

  fs.mkdirSync(commandsDir, { recursive: true });
  for (const file of fs.readdirSync(commandsSrc)) {
    fs.copyFileSync(path.join(commandsSrc, file), path.join(commandsDir, file));
    console.log(`  + .claude/commands/${file}`);
  }
  upsertBlock(instructionsFile, readSkillBody("frenchie"));
}

function installCursorSkill(dryRun) {
  const rulesFile = projectPath(".cursorrules");
  if (dryRun) {
    console.log("  [plan] upsert .cursorrules");
    return;
  }
  upsertBlock(rulesFile, readSkillBody("frenchie"));
}

function installCodexSkill(dryRun) {
  const agentsFile = projectPath("AGENTS.md");
  const codexSkillDir = projectPath(".agents", "skills", "frenchie");
  const canonicalSkill = path.join(SKILLS_DIR, "frenchie", "SKILL.md");

  if (dryRun) {
    console.log("  [plan] copy .agents/skills/frenchie/SKILL.md");
    console.log("  [plan] upsert AGENTS.md");
    return;
  }

  fs.mkdirSync(codexSkillDir, { recursive: true });
  fs.copyFileSync(canonicalSkill, path.join(codexSkillDir, "SKILL.md"));
  console.log(`  + .agents/skills/frenchie/SKILL.md`);
  upsertBlock(agentsFile, readSkillBody("frenchie"));
}

function installWindsurfSkill(dryRun) {
  const rulesFile = projectPath(".windsurfrules");
  if (dryRun) {
    console.log("  [plan] upsert .windsurfrules");
    return;
  }
  upsertBlock(rulesFile, readSkillBody("frenchie"));
}

function installAntigravitySkill(dryRun) {
  installGenericAgentSkill(dryRun);
}

function installVSCodeSkill(dryRun) {
  const instructionsFile = projectPath(".github", "copilot-instructions.md");
  if (dryRun) {
    console.log("  [plan] upsert .github/copilot-instructions.md");
    return;
  }
  fs.mkdirSync(path.dirname(instructionsFile), { recursive: true });
  upsertBlock(instructionsFile, readSkillBody("frenchie"));
}

function installGeminiSkill(dryRun) {
  const rulesFile = projectPath("GEMINI.md");
  if (dryRun) {
    console.log("  [plan] upsert GEMINI.md");
    return;
  }
  upsertBlock(rulesFile, readSkillBody("frenchie"));
}

function installZedSkill(dryRun) {
  const rulesFile = projectPath(".rules");
  if (dryRun) {
    console.log("  [plan] upsert .rules");
    return;
  }
  upsertBlock(rulesFile, readSkillBody("frenchie"));
}

function installGenericAgentSkill(dryRun) {
  const dest = path.join(GENERIC_AGENT.skillDir, "frenchie");
  const src = path.join(SKILLS_DIR, "frenchie");
  const exists = fs.existsSync(dest);

  if (dryRun) {
    console.log(`  [plan] ${exists ? "update" : "install"} .agent/skills/frenchie/`);
    return;
  }

  copyDir(src, dest);
  console.log(`  + .agent/skills/frenchie/ (${exists ? "updated" : "installed"})`);
}

// ─── MCP config writers ───────────────────────────────────────────────────────

/**
 * Resolve an absolute path to `npx` so GUI-launched agents (Antigravity, Claude
 * Desktop, Windsurf, Zed, etc.) can spawn the stdio server even when they
 * inherit a sterile launchd PATH. Falls back to the bare `"npx"` string if
 * nothing can be resolved.
 */
function resolveNpxPath() {
  const isWindows = process.platform === "win32";
  try {
    const which = isWindows ? "where" : "which";
    const out = execFileSync(which, ["npx"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {
    // fall through to heuristic
  }
  const nodeDir = path.dirname(process.execPath);
  const candidate = path.join(nodeDir, isWindows ? "npx.cmd" : "npx");
  if (fs.existsSync(candidate)) return candidate;
  return "npx";
}

/**
 * Build a PATH value for the MCP server's env block that includes Node's own
 * install dir plus common system paths, so the `#!/usr/bin/env node` shebang
 * inside `npx` can still resolve `node` when the parent launched us with an
 * empty PATH.
 */
function resolvePathEnv() {
  const nodeDir = path.dirname(process.execPath);
  const defaults = process.platform === "win32"
    ? [nodeDir, "C:\\Program Files\\nodejs", "C:\\Windows\\System32", "C:\\Windows"]
    : [nodeDir, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
  const current = (process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (const p of [...defaults, ...current]) {
    if (p && !seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
  return merged.join(path.delimiter);
}

function buildMcpEntry(apiKey) {
  const env = { PATH: resolvePathEnv() };
  if (apiKey) env.FRENCHIE_API_KEY = apiKey;
  return {
    command: resolveNpxPath(),
    args: ["-y", PACKAGE_SPEC, "mcp"],
    env
  };
}

function mergeJsonMcpServers(filePath, apiKey, { servers = "mcpServers" } = {}) {
  const existing = readJsonSafe(filePath);
  existing[servers] = existing[servers] || {};
  existing[servers].frenchie = buildMcpEntry(apiKey);
  writeJson(filePath, existing);
}

function mergeJsonZedContextServers(filePath, apiKey) {
  const existing = readJsonSafe(filePath);
  existing.context_servers = existing.context_servers || {};
  existing.context_servers.frenchie = {
    source: "custom",
    ...buildMcpEntry(apiKey)
  };
  writeJson(filePath, existing);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Cannot merge MCP config: ${filePath} is not valid JSON (${err.message}). Fix it and re-run.`
    );
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existed = fs.existsSync(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  logWrite(filePath, existed ? "updated" : "installed");
}

function upsertCodexTomlBlock(filePath, apiKey) {
  let existing = "";
  if (fs.existsSync(filePath)) existing = fs.readFileSync(filePath, "utf8");

  const entry = buildMcpEntry(apiKey);
  const apiKeyLine = apiKey ? `FRENCHIE_API_KEY = "${apiKey}"` : "# FRENCHIE_API_KEY = \"fr_…\"";
  const blockLines = [
    "[mcp_servers.frenchie]",
    `command = ${JSON.stringify(entry.command)}`,
    `args = ${tomlStringArray(entry.args)}`,
    "",
    "[mcp_servers.frenchie.env]",
    `PATH = ${JSON.stringify(entry.env.PATH)}`,
    apiKeyLine
  ];

  // Replace the existing frenchie block (including any nested `[mcp_servers.frenchie.env]`
  // subtables) rather than just the first header, so reruns stay idempotent.
  const existed = fs.existsSync(filePath);
  const next = replaceCodexFrenchieBlock(existing, blockLines);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  logWrite(filePath, existed ? "updated" : "installed");
}

/**
 * Line-based TOML editor scoped to the `mcp_servers.frenchie` block.
 *
 * - Finds the first `[mcp_servers.frenchie]` header.
 * - Consumes through any following nested `[mcp_servers.frenchie.*]` subtables.
 * - Stops at the next top-level header that isn't nested under `mcp_servers.frenchie`, or EOF.
 * - Replaces that whole span with `blockLines` (an array of lines for the new block).
 * - Appends if no existing block is found.
 */
function replaceCodexFrenchieBlock(source, blockLines) {
  const lines = source.split("\n");
  const block = blockLines.join("\n");

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (startIdx === -1) {
      if (/^\s*\[mcp_servers\.frenchie\]\s*$/.test(line)) {
        startIdx = i;
      }
      continue;
    }
    // Inside the block — stop when we hit a header that isn't nested under frenchie.
    const headerMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (headerMatch) {
      const name = headerMatch[1].trim();
      const nested = name === "mcp_servers.frenchie" || name.startsWith("mcp_servers.frenchie.");
      if (!nested) {
        endIdx = i; // `i` is the first line after our block
        break;
      }
    }
  }

  if (startIdx === -1) {
    const separator = source.length > 0 && !source.endsWith("\n\n") ? "\n\n" : "";
    return source + separator + block + "\n";
  }

  if (endIdx === -1) endIdx = lines.length;

  const beforeLines = lines.slice(0, startIdx);
  const afterLines = lines.slice(endIdx);

  const before = beforeLines.join("\n");
  const after = afterLines.join("\n");

  // Preserve the blank line between the previous block and our frenchie header.
  // `beforeLines` ending with "" means there *was* a blank line; `.join("\n")`
  // on `[..., ""]` produces "...\n" rather than "...\n\n", so add a newline back.
  const beforeSuffix = before
    ? beforeLines[beforeLines.length - 1] === "" ? "\n" : "\n\n"
    : "";

  // Mirror logic for the trailing side: preserve a blank line between our
  // block and whatever follows.
  const afterPrefix = after
    ? afterLines[0] === "" ? "\n" : "\n\n"
    : "";

  return before + beforeSuffix + block + afterPrefix + after;
}

function writeMcpConfig(agent, apiKey, { global }) {
  const mcp = agent.mcp;
  if (!mcp) return { wrote: false, reason: "agent has no MCP config" };

  const target = global ? mcp.global : mcp.project;
  if (!target) {
    const alt = global ? mcp.project : mcp.global;
    if (alt) {
      return {
        wrote: false,
        reason: global
          ? `no global MCP path — drop --global or configure per-project at ${path.relative(PROJECT_ROOT, alt.path)}`
          : `no project-level MCP path — rerun with --global to write ${alt.path.replace(HOME, "~")}`,
        suggestPath: alt.path
      };
    }
    return { wrote: false, reason: "no MCP config path defined for this agent" };
  }

  if (!apiKey) {
    return {
      wrote: false,
      reason: `no API key — pass --api-key fr_... (target would be ${target.path.replace(HOME, "~")})`,
      suggestPath: target.path
    };
  }

  if (target.printOnly) {
    return {
      wrote: false,
      printOnly: true,
      reason: `paste this into ${target.path}`,
      suggestPath: target.path
    };
  }

  if (DRY_RUN) {
    console.log(`  [plan] write MCP entry to ${target.path.replace(HOME, "~")}`);
    return { wrote: true, path: target.path };
  }

  switch (target.format) {
    case "json-mcp-servers":
      mergeJsonMcpServers(target.path, apiKey);
      break;
    case "json-vscode":
      mergeJsonMcpServers(target.path, apiKey, { servers: "servers" });
      break;
    case "json-zed-context-servers":
      mergeJsonZedContextServers(target.path, apiKey);
      break;
    case "toml-codex":
      upsertCodexTomlBlock(target.path, apiKey);
      break;
    default:
      return { wrote: false, reason: `unknown format: ${target.format}` };
  }

  return { wrote: true, path: target.path };
}

// ─── API-key sourcing ─────────────────────────────────────────────────────────

// Shape check only — not authentication. Matches "fr_" followed by any
// URL-safe characters. Intentionally looser than the real key format
// (`apps/worker/src/auth/auth.utils.ts` generates `fr_` + 32 hex) so this
// regex doesn't reject test fixtures or keys issued with different
// lengths in the future. The server validates real keys; this just
// filters out obvious non-keys like "REPLACE_ME" or another vendor's
// key format when we're scanning existing configs.
const API_KEY_SHAPE = /^fr_[A-Za-z0-9_-]+$/;

// Shared probe order for both legacy-detect and key-reuse: project-scoped
// first (so an install run in a project prefers that project's own
// frenchie entry), then user-global. Hoisted into a function because the
// concrete paths depend on HOME (which is resolved at runtime) and
// projectPath (which resolves against process.cwd()). DRY here matters —
// adding a new MCP host means editing one list, not two.
function jsonMcpConfigPaths() {
  return [
    projectPath(".mcp.json"),
    projectPath(".cursor", "mcp.json"),
    projectPath(".vscode", "mcp.json"),
    projectPath(".gemini", "settings.json"),
    homePath(".cursor", "mcp.json"),
    homePath(".claude.json"),
    homePath(".gemini", "settings.json"),
    homePath(".codeium", "windsurf", "mcp_config.json"),
    homePath(".config", "zed", "settings.json"),
    antigravityGlobalPath(),
    claudeDesktopGlobalPath()
  ];
}

function tomlMcpConfigPaths() {
  return [projectPath(".codex", "config.toml"), homePath(".codex", "config.toml")];
}

/**
 * Walk a parsed JSON config for the frenchie server entry. Handles:
 *   - Top-level `mcpServers` / `servers` / `context_servers`
 *   - Claude Code's `~/.claude.json` that nests servers under `projects[*]`
 *
 * Returns the first frenchie object found (or `null`). Callers then pull
 * `url` (legacy-detect) or `env.FRENCHIE_API_KEY` (key-reuse) off it.
 * This shared helper is why the detect and reuse paths stay consistent
 * when we add a new nesting convention in the future.
 */
function findFrenchieServerEntry(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const containers = [parsed];
  const mcpServerKeys = ["mcpServers", "servers", "context_servers"];
  if (parsed.projects && typeof parsed.projects === "object") {
    for (const project of Object.values(parsed.projects)) {
      if (project && typeof project === "object") containers.push(project);
    }
  }
  for (const container of containers) {
    for (const key of mcpServerKeys) {
      const servers = container[key];
      if (!servers || typeof servers !== "object") continue;
      const frenchie = servers.frenchie;
      if (frenchie && typeof frenchie === "object") return frenchie;
    }
  }
  return null;
}

function redactApiKey(apiKey) {
  // Never log a full key. Last 4 chars is enough for a user to recognize
  // which key was picked up ("yes that's the one I rotated last week")
  // without creating a log-file leak of the plaintext secret.
  if (typeof apiKey !== "string" || apiKey.length < 8) return "fr_***";
  return `fr_…${apiKey.slice(-4)}`;
}

async function resolveApiKey() {
  if (CLI_API_KEY) return CLI_API_KEY;
  if (process.env.FRENCHIE_API_KEY) return process.env.FRENCHIE_API_KEY;

  const reused = readApiKeyFromExistingConfig();
  if (reused) {
    console.log(
      `✓ Reusing API key ${redactApiKey(reused.apiKey)} from ${reused.path.replace(HOME, "~")}`
    );
    return reused.apiKey;
  }

  if (!process.stdin.isTTY) return null;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question("Frenchie API key (starts with fr_). Leave blank to skip MCP config: ", (v) =>
      resolve(v.trim())
    )
  );
  rl.close();
  return answer || null;
}

/**
 * Scan the shared MCP config probe paths for an existing
 * `env.FRENCHIE_API_KEY` on the frenchie server entry. First match wins —
 * see `jsonMcpConfigPaths` for the canonical order.
 *
 * Frenchie API keys are shown only once at creation (see dashboard), so
 * forcing `--api-key fr_…` on every re-run of `install` leaves users
 * without an upgrade path if they've lost the plaintext copy. Reading
 * the key back from an existing MCP config fixes that.
 *
 * Returns `{ apiKey, path }` or `null`. A key that doesn't match
 * `API_KEY_SHAPE` is ignored (malformed seed, typo, accidental placeholder).
 */
function readApiKeyFromExistingConfig() {
  for (const filePath of jsonMcpConfigPaths()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const frenchie = findFrenchieServerEntry(parsed);
      const apiKey = frenchie?.env?.FRENCHIE_API_KEY;
      if (typeof apiKey === "string" && apiKey.length > 0 && API_KEY_SHAPE.test(apiKey)) {
        return { apiKey, path: filePath };
      }
    } catch {
      // Non-JSON / malformed — skip without crashing.
    }
  }

  for (const filePath of tomlMcpConfigPaths()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const source = fs.readFileSync(filePath, "utf8");
      const apiKey = tomlReadFrenchieApiKey(source);
      if (apiKey && API_KEY_SHAPE.test(apiKey)) {
        return { apiKey, path: filePath };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function tomlReadFrenchieApiKey(source) {
  // Line-based scan — no TOML parser dependency. We look for a line of the
  // form `FRENCHIE_API_KEY = "fr_…"` inside an `[mcp_servers.frenchie.env]`
  // block. The legacy-detect helper uses the same line walk pattern for
  // `url = "…"`, so the risk surface is well-understood.
  const lines = source.split(/\r?\n/);
  let inEnvBlock = false;
  for (const line of lines) {
    const headerMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (headerMatch) {
      inEnvBlock = headerMatch[1].trim() === "mcp_servers.frenchie.env";
      continue;
    }
    if (!inEnvBlock) continue;
    const keyMatch = line.match(/^\s*FRENCHIE_API_KEY\s*=\s*"([^"]+)"/);
    if (keyMatch) return keyMatch[1];
  }
  return null;
}

// ─── Command: install ─────────────────────────────────────────────────────────

function detectTierAAgents() {
  return AUTO_DETECT_ORDER.filter((key) => AGENTS_TIER_A[key].detect());
}

/**
 * Scan common MCP config locations for legacy 0.1.x-style HTTP `frenchie`
 * entries. Those entries shadow the new project-scoped stdio config and are
 * the single most common source of "upgraded but nothing changed" reports.
 * Returns a list of `{ path, kind }` hits so the installer can warn the user.
 *
 * Shares probe-path lists + the frenchie-entry walker with
 * `readApiKeyFromExistingConfig` — adding a new MCP host means editing
 * `jsonMcpConfigPaths()` / `tomlMcpConfigPaths()` once.
 */
function detectLegacyHttpConfig() {
  const hits = [];

  for (const filePath of jsonMcpConfigPaths()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (jsonHasLegacyFrenchieHttp(parsed)) {
        hits.push({ path: filePath, kind: "HTTP url" });
      }
    } catch {
      // Non-JSON or malformed — skip rather than crash the installer.
    }
  }

  // Codex TOML — grep for a `url = "https://...mcp.getfrenchie..."` inside an
  // `[mcp_servers.frenchie]` block. Line-based is safer than pulling in a TOML
  // parser for what is essentially a detect-and-warn pass.
  for (const filePath of tomlMcpConfigPaths()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const source = fs.readFileSync(filePath, "utf8");
      if (tomlHasLegacyFrenchieHttp(source)) {
        hits.push({ path: filePath, kind: "HTTP url in [mcp_servers.frenchie]" });
      }
    } catch {
      // ignore
    }
  }

  return hits;
}

function jsonHasLegacyFrenchieHttp(parsed) {
  const frenchie = findFrenchieServerEntry(parsed);
  if (!frenchie) return false;
  if (typeof frenchie.url === "string" && frenchie.url.length > 0) return true;
  if (typeof frenchie.serverUrl === "string" && frenchie.serverUrl.length > 0) return true;
  return false;
}

function tomlHasLegacyFrenchieHttp(source) {
  const lines = source.split(/\r?\n/);
  let inFrenchieBlock = false;
  for (const line of lines) {
    const headerMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (headerMatch) {
      const name = headerMatch[1].trim();
      inFrenchieBlock = name === "mcp_servers.frenchie" || name.startsWith("mcp_servers.frenchie.");
      continue;
    }
    if (!inFrenchieBlock) continue;
    if (/^\s*url\s*=\s*"/.test(line)) return true;
  }
  return false;
}

async function cmdInstall() {
  if (DRY_RUN) console.log("\nDry run — no files will be written:\n");
  else console.log("\nInstalling Frenchie skills...\n");

  const targets = resolveInstallTargets();
  if (targets.length === 0) return;

  const legacyHits = detectLegacyHttpConfig();
  if (legacyHits.length > 0) {
    console.warn(
      "⚠️  Legacy Frenchie HTTP config detected — these will shadow the new stdio entry on some agents:"
    );
    for (const hit of legacyHits) {
      console.warn(`     ${hit.path.replace(HOME, "~")} (${hit.kind})`);
    }
    console.warn(
      "  Fix (removes the shadow):\n" +
      "     https://getfrenchie.dev/docs/troubleshooting#http-shadow\n" +
      "  Full upgrade guide:\n" +
      "     https://getfrenchie.dev/docs#migrating\n"
    );
  }

  const apiKey = await resolveApiKey();
  if (!apiKey) {
    console.warn(
      "! No API key provided — skill files will still be installed, but MCP config writes will be skipped.\n" +
      "  First-time setup: pass --api-key fr_... or set FRENCHIE_API_KEY and rerun.\n" +
      "  Re-installs pick up your existing key automatically, so this usually only happens on the very first run.\n" +
      "  Common issues: https://getfrenchie.dev/docs/troubleshooting\n"
    );
  }

  for (const key of targets) {
    const tier = resolveAgentTier(key);
    if (!tier) continue;

    if (tier === "tier-b") {
      runTierBInstall(key, apiKey);
      continue;
    }

    if (tier === "generic") {
      runGenericInstall();
      continue;
    }

    runTierAInstall(key, apiKey);
  }
}

function resolveInstallTargets() {
  if (AGENT_FLAG) {
    if (AGENTS_TIER_A[AGENT_FLAG]) return [AGENT_FLAG];
    if (TIER_B[AGENT_FLAG]) return [AGENT_FLAG];
    if (AGENT_FLAG === "agent" || AGENT_FLAG === "generic") return ["generic"];
    console.error(`Unknown agent: "${AGENT_FLAG}"`);
    console.log("\nAvailable agents:");
    console.log("  Tier A (auto-install): " + Object.keys(AGENTS_TIER_A).join(", "));
    console.log("  Tier B (copy-paste):   " + Object.keys(TIER_B).join(", "));
    console.log("  Generic:               agent");
    process.exit(1);
  }

  if (INSTALL_ALL) return Object.keys(AGENTS_TIER_A);

  const detected = detectTierAAgents();
  if (detected.length > 0) return detected;

  // Nothing detected — fall back to generic skill install.
  console.log("No tested agent markers found. Falling back to the generic skill target at .agent/skills/frenchie/\n");
  console.log("For a first-class install, rerun with one of:");
  console.log("  npx @lab94/frenchie install --agent claude|cursor|codex|antigravity|windsurf|vscode|gemini|zed|claude-desktop\n");
  return ["generic"];
}

function resolveAgentTier(key) {
  if (key === "generic") return "generic";
  if (AGENTS_TIER_A[key]) return "tier-a";
  if (TIER_B[key]) return "tier-b";
  return null;
}

function runTierAInstall(key, apiKey) {
  const agent = AGENTS_TIER_A[key];
  console.log(`  [${agent.name}]`);

  if (agent.installSkill) agent.installSkill(DRY_RUN);

  const mcpResult = writeMcpConfig(agent, apiKey, { global: GLOBAL_MODE });
  if (!mcpResult.wrote) {
    const prefix = mcpResult.printOnly ? "MCP snippet" : "skipped MCP config";
    console.log(`  · ${prefix}: ${mcpResult.reason}`);
    if (mcpResult.suggestPath) {
      console.log(
        `    ${mcpResult.printOnly ? "snippet" : "example entry"}:\n${indent(formatSnippet(agent, apiKey || "fr_YOUR_KEY"), "    ")}`
      );
    }
  }

  if (!DRY_RUN) printAgentHint(agent);
  console.log();
}

function printAgentHint(agent) {
  const hint = agent.hint;
  if (!hint) return;
  if (typeof hint === "string") {
    // Legacy string-form hints, still supported for future additions.
    console.log(`  → ${hint}`);
    return;
  }
  console.log(`  → ${hint.restart} To invoke Frenchie in ${agent.name}:`);
  for (const invocation of hint.invocations) {
    console.log(`       ${invocation}`);
  }
  for (const note of hint.notes) {
    console.log(`     Note: ${note}`);
  }
  if (hint.docsUrl) {
    console.log(`     Full guide: ${hint.docsUrl}`);
  }
}

function runTierBInstall(key, apiKey) {
  const tb = TIER_B[key];
  console.log(`  [${tb.name}]`);
  if (!DRY_RUN) {
    installGenericAgentSkill(false);
    console.log(
      `  · ${tb.name} has no auto-install path. Paste this snippet wherever ${tb.name} reads MCP config:\n` +
      indent(formatJsonMcpSnippet(apiKey || "fr_YOUR_KEY"), "    ")
    );
    console.log(`  · Docs: ${tb.docs}`);
  }
  console.log();
}

function runGenericInstall() {
  console.log(`  [${GENERIC_AGENT.name}]`);
  installGenericAgentSkill(DRY_RUN);
  console.log();
}

function formatSnippet(agent, apiKey) {
  const target = (GLOBAL_MODE ? agent.mcp?.global : agent.mcp?.project) || agent.mcp?.global || agent.mcp?.project;
  if (!target) return formatJsonMcpSnippet(apiKey);
  switch (target.format) {
    case "toml-codex":
      return formatCodexTomlSnippet(apiKey);
    case "json-zed-context-servers":
      return formatZedSnippet(apiKey);
    case "json-vscode":
      return formatVSCodeSnippet(apiKey);
    default:
      return formatJsonMcpSnippet(apiKey);
  }
}

function formatJsonMcpSnippet(apiKey) {
  return JSON.stringify({ mcpServers: { frenchie: buildMcpEntry(apiKey) } }, null, 2);
}

function formatVSCodeSnippet(apiKey) {
  return JSON.stringify({ servers: { frenchie: buildMcpEntry(apiKey) } }, null, 2);
}

function formatZedSnippet(apiKey) {
  return JSON.stringify(
    {
      context_servers: {
        frenchie: { source: "custom", ...buildMcpEntry(apiKey) }
      }
    },
    null,
    2
  );
}

function formatCodexTomlSnippet(apiKey) {
  const entry = buildMcpEntry(apiKey);
  return [
    "[mcp_servers.frenchie]",
    `command = ${JSON.stringify(entry.command)}`,
    `args = ${tomlStringArray(entry.args)}`,
    "",
    "[mcp_servers.frenchie.env]",
    `PATH = ${JSON.stringify(entry.env.PATH)}`,
    `FRENCHIE_API_KEY = "${apiKey}"`
  ].join("\n");
}

function indent(str, prefix) {
  return str
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

function tomlStringArray(values) {
  return "[" + values.map((v) => JSON.stringify(v)).join(", ") + "]";
}

// ─── Command: setup ───────────────────────────────────────────────────────────

function cmdSetup() {
  console.log(`
Frenchie MCP setup
==================

Recommended (stdio — local agents):
  npx @lab94/frenchie install --api-key fr_...

Per-agent:
  Claude Code      → ${tierALoc("claude")}
  Cursor           → ${tierALoc("cursor")}
  Codex            → ${tierALoc("codex")}
  Antigravity      → ${tierALoc("antigravity")} (requires --global)
  Windsurf         → ${tierALoc("windsurf")} (requires --global)
  VS Code Copilot  → ${tierALoc("vscode")}
  Gemini CLI       → ${tierALoc("gemini")}
  Zed              → ${tierALoc("zed")} (requires --global)
  Claude Desktop   → ${tierALoc("claude-desktop")} (requires --global)

Global (user-level) installs:
  npx @lab94/frenchie install --agent <name> --global --api-key fr_...

For hosted agents that can't run npm binaries (Lovable, Manus, Claude.ai, ChatGPT.com, Le Chat):
  connect to https://mcp.getfrenchie.dev over HTTP with the Authorization: Bearer fr_... header.

Get your API key at: https://getfrenchie.dev/dashboard/api-keys
`);
}

function tierALoc(key) {
  const agent = AGENTS_TIER_A[key];
  if (!agent) return "—";
  const t = agent.mcp?.project || agent.mcp?.global;
  if (!t) return "—";
  return t.path.replace(HOME, "~");
}

// ─── Command: list ────────────────────────────────────────────────────────────

function cmdList() {
  const skills = getSkills();
  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }
  console.log(`\n@lab94/frenchie — ${skills.length} skill(s) available\n`);
  for (const skill of skills) {
    const desc = getSkillDescription(skill);
    const short = desc.split(".")[0].substring(0, 80);
    console.log(`  ${skill.padEnd(20)} ${short}`);
  }
  console.log();
}

// ─── Command: update ──────────────────────────────────────────────────────────

function cmdUpdate() {
  const installed = AUTO_DETECT_ORDER.filter((key) => AGENTS_TIER_A[key].detect());
  if (installed.length === 0) {
    console.log("No tested-agent markers detected. Install first:");
    console.log("  npx @lab94/frenchie install --agent <name> --api-key fr_...");
    return;
  }
  console.log(`\nUpdating Frenchie skills for ${installed.length} agent(s)...\n`);
  for (const key of installed) {
    const agent = AGENTS_TIER_A[key];
    console.log(`  [${agent.name}]`);
    if (agent.installSkill) agent.installSkill(false);
    console.log();
  }
  console.log("Skill files refreshed. MCP config was NOT modified — rerun `install` to update it (your existing API key is reused automatically).");
}

// ─── Command: mcp (run bundled stdio server) ──────────────────────────────────

const MCP_SUBCOMMAND_HELP = `
@lab94/frenchie mcp — bundled stdio MCP server

Usage:
  npx @lab94/frenchie mcp              Start the stdio MCP server (used by MCP clients)
  npx @lab94/frenchie mcp --help       Print this help and exit
  npx @lab94/frenchie mcp --version    Print the package version and exit
  npx @lab94/frenchie mcp --selftest   Boot the server, run initialize + tools/list, exit 0 on success

Environment:
  FRENCHIE_API_KEY     API key (fr_...) used when tool callers don't supply their own
  FRENCHIE_API_URL     Override the worker API URL (defaults to https://api.getfrenchie.dev)
  FRENCHIE_OUTPUT_DIR  Where to write .frenchie/<name>/result.md (defaults to cwd)

Full guide: https://getfrenchie.dev/docs
Troubleshooting: https://getfrenchie.dev/docs/troubleshooting
`.trim();

function cmdMcp() {
  const mcpArgs = rawFlags;
  if (mcpArgs.includes("--help") || mcpArgs.includes("-h")) {
    console.log(MCP_SUBCOMMAND_HELP);
    return;
  }
  if (mcpArgs.includes("--version") || mcpArgs.includes("-v")) {
    console.log(require("../package.json").version);
    return;
  }
  if (mcpArgs.includes("--selftest")) {
    runSelftest();
    return;
  }
  // The bundled entry runs main() at module scope, so requiring it starts the server.
  require("../dist/mcp.cjs");
}

function runSelftest() {
  const { spawn } = require("child_process");
  const bundlePath = path.join(__dirname, "..", "dist", "mcp.cjs");
  if (!fs.existsSync(bundlePath)) {
    console.error(`FAIL: bundle not found at ${bundlePath}. Run "pnpm build" in packages/skill.`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [bundlePath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FRENCHIE_API_KEY: process.env.FRENCHIE_API_KEY ?? "fr_selftest" }
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  const pending = new Map();
  let nextId = 1;

  const timer = setTimeout(() => {
    stderrBuf && console.error(stderrBuf);
    console.error("FAIL: self-test timed out after 10s");
    child.kill("SIGKILL");
    process.exit(1);
  }, 10_000);

  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    for (;;) {
      const newlineIdx = stdoutBuf.indexOf("\n");
      if (newlineIdx === -1) break;
      const line = stdoutBuf.slice(0, newlineIdx).trim();
      stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const resolver = pending.get(msg.id);
      if (resolver) {
        pending.delete(msg.id);
        resolver(msg);
      }
    }
  });

  function send(method, params) {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(payload + "\n");
    return new Promise((resolve) => pending.set(id, resolve));
  }

  (async () => {
    try {
      const initResp = await send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "frenchie-selftest", version: "0.0.0" }
      });
      if (initResp.error) throw new Error(`initialize failed: ${JSON.stringify(initResp.error)}`);

      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

      const listResp = await send("tools/list", {});
      if (listResp.error) throw new Error(`tools/list failed: ${JSON.stringify(listResp.error)}`);
      const tools = listResp.result?.tools ?? [];
      const names = tools.map((t) => t.name).sort();
      // Selftest boots the server in stdio mode, which exposes only the three
      // core tools. upload_file / fetch_result_file are HTTP-only.
      const expected = ["extract_to_markdown", "generate_image", "get_job_result", "ocr_to_markdown", "transcribe_to_markdown"];
      for (const name of expected) {
        if (!names.includes(name)) throw new Error(`missing tool: ${name}. Got: ${names.join(", ")}`);
      }

      clearTimeout(timer);
      child.kill();
      console.log(`PASS: ${names.length} tools registered (${names.join(", ")})`);
      process.exit(0);
    } catch (err) {
      clearTimeout(timer);
      stderrBuf && console.error(stderrBuf);
      console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
      child.kill("SIGKILL");
      process.exit(1);
    }
  })();
}

// ─── Command: help ────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
@lab94/frenchie — Frenchie skills + stdio MCP server for AI agents

Usage:
  npx @lab94/frenchie <command> [options]

Commands:
  install                    Auto-detect tested agents and install skill + MCP config (project-only)
  install --agent <name>     Install for a specific agent
  install --all              Install for every Tier A agent
  install --global           Allow writes to $HOME MCP configs (required for Antigravity, Claude Desktop)
  install --api-key fr_...   Seed the MCP config with an API key. On re-runs the installer reuses the key from your existing MCP config, so this flag is only required on the first install.
  install --dry-run          Preview what would be installed
  list                       List bundled skills
  setup                      Show MCP setup instructions + target paths per agent
  update                     Re-copy skill files for every detected agent (doesn't touch MCP config)
  mcp                        Run the bundled stdio MCP server (used by MCP clients, not humans)

Agents (Tier A — auto-install):
  ${Object.keys(AGENTS_TIER_A).join(", ")}

Agents (Tier B — copy-paste only):
  ${Object.keys(TIER_B).join(", ")}

Examples:
  npx @lab94/frenchie install --api-key fr_...
  npx @lab94/frenchie install --agent codex --api-key fr_...
  npx @lab94/frenchie install --agent antigravity --global --api-key fr_...
  npx @lab94/frenchie install --agent claude-desktop --global --api-key fr_...
  npx @lab94/frenchie install --all --dry-run
`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

(async () => {
  switch (command) {
    case "list":
      cmdList();
      break;
    case "install":
      await cmdInstall();
      break;
    case "setup":
      cmdSetup();
      break;
    case "update":
      cmdUpdate();
      break;
    case "mcp":
      cmdMcp();
      break;
    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;
    default:
      if (!command) cmdHelp();
      else {
        console.error(`Unknown command: "${command}"`);
        cmdHelp();
        process.exit(1);
      }
  }
})();
