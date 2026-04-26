import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  MCP_REGISTRY_NAME,
  SKILL_ASSET_FILES,
  SKILL_COMMANDS,
  SKILL_PACKAGE_NAME
} from "../src/index.ts";

const packageDirectory = resolve(import.meta.dirname, "..");
const repoRoot = existsSync(join(packageDirectory, "server.json"))
  ? packageDirectory
  : resolve(packageDirectory, "..", "..");

function walkTsFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

test("exports stable skill metadata and command list", () => {
  assert.equal(SKILL_PACKAGE_NAME, "@lab94/frenchie");
  assert.deepEqual(SKILL_COMMANDS, [
    "/ocr <file>",
    "/transcribe <file>",
    "/generate-image <prompt>",
    "/frenchie-status"
  ]);
  assert.equal(SKILL_ASSET_FILES.instructions, "instructions.md");
  assert.equal(SKILL_ASSET_FILES.commands, "commands.md");
  assert.equal(SKILL_ASSET_FILES.config, "config.md");
  assert.equal(SKILL_ASSET_FILES.readme, "README.md");
});

test("ships markdown assets and export entries for downstream consumers", () => {
  const packageJson = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
    files?: string[];
    exports?: Record<string, unknown>;
  };

  for (const assetFile of Object.values(SKILL_ASSET_FILES)) {
    assert.equal(existsSync(join(packageDirectory, assetFile)), true, `${assetFile} should exist`);
    assert.ok(packageJson.files?.includes(assetFile), `${assetFile} should be listed in package files`);
    assert.equal(packageJson.exports?.[`./${assetFile}`], `./${assetFile}`);
  }

  // mcp-runtime subpath export points at the dist bundle so workspace consumers (apps/mcp) resolve it.
  const mcpRuntimeExport = packageJson.exports?.["./mcp-runtime"] as Record<string, string> | undefined;
  assert.ok(mcpRuntimeExport, "mcp-runtime subpath export should exist");
  assert.equal(mcpRuntimeExport?.import, "./dist/mcp-runtime.js");
  assert.equal(mcpRuntimeExport?.require, "./dist/mcp-runtime.cjs");
});

test("npm publish metadata points only at public surfaces", () => {
  // The monorepo (Lab94/frenchie) is private, but packages/skill/ is synced
  // on every release to the public mirror Lab94/frenchie-skill so PulseMCP
  // and Smithery reviewers can inspect real source (see CLAUDE.md rule #6).
  // Metadata contract:
  //   - `repository` points at the PUBLIC mirror, so npmjs.com's "Repository"
  //     link lands on a real repo rather than a 404 on the private monorepo.
  //   - `bugs.url` stays on getfrenchie.dev/docs/troubleshooting — CLAUDE.md
  //     rule #2 keeps issue-tracker surfaces within the product domain, and
  //     directory reviewers key on `repository` anyway.
  //   - `license` is MIT, matching the public mirror's LICENSE file.
  const packageJson = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
    description?: string;
    homepage?: string;
    license?: string;
    publishConfig?: { access?: string };
    repository?: { type?: string; url?: string };
    bugs?: { url?: string };
    mcpName?: string;
    keywords?: string[];
  };

  // Description retains "stdio MCP server" so existing discovery signals stay
  // intact, but now also signals the broader capability surface (multimodal,
  // OCR+transcription today, image generation and more rolling out).
  assert.match(packageJson.description ?? "", /stdio MCP server/i);
  assert.match(packageJson.description ?? "", /multimodal|image generation/i, "description should signal the broader capability surface, not just OCR/transcription");
  assert.equal(packageJson.homepage, "https://www.getfrenchie.dev/");
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.repository?.type, "git");
  assert.equal(
    packageJson.repository?.url,
    "git+https://github.com/Lab94/frenchie-skill.git",
    "repository.url must point at the public mirror Lab94/frenchie-skill — never the private monorepo Lab94/frenchie"
  );
  // bugs.url points at /docs/troubleshooting (a page that actually exists
  // in the frontend) rather than the mirror's issues URL. External users
  // who click "Report issues" on npmjs.com land on the symptom-first fix
  // guide immediately instead of hopping out to GitHub.
  assert.equal(packageJson.bugs?.url, "https://getfrenchie.dev/docs/troubleshooting");

  // mcpName is required by the Official MCP Registry for npm verification —
  // it lets the registry tie the published package back to server.json.
  // We use the `io.github.<owner>/<repo>` form because the Official Registry
  // verifies ownership via the GitHub repository named here (Lab94/frenchie-skill
  // is the public mirror submitted to directories). Using a `io.getfrenchie/*`
  // reverse-DNS form would require DNS-based verification of getfrenchie.dev
  // (not yet wired), so GitHub auth is the verifiable path today.
  assert.equal(packageJson.mcpName, "io.github.lab94/frenchie-skill");

  // Keywords must cover current capability surface (OCR, transcription) AND
  // signal the broader multimodal direction so directory search picks up
  // discovery terms beyond the file-to-Markdown framing.
  const keywords = packageJson.keywords ?? [];
  for (const required of ["mcp", "ocr", "transcription", "multimodal", "markdown"]) {
    assert.ok(keywords.includes(required), `keywords must include "${required}" — got: ${keywords.join(", ")}`);
  }
});

test("server.json version fields stay locked to packages/skill/package.json", () => {
  // The Official MCP Registry reads server.json at submission time. If any
  // of its three version references (root `version`, `packages[0].version`,
  // and the `@lab94/frenchie@<ver>` embedded in runtimeArguments) drift from
  // the npm tarball's version, the registry ships metadata that does not
  // match the package being installed. Since server.json lives at the repo
  // root but the release tag keys on packages/skill/package.json, the only
  // safe invariant is: all four versions are equal. The publish workflow
  // also verifies the tag matches packages/skill/package.json version, so
  // this test closes the loop — any drift fails CI before a tag is ever
  // pushed.
  const serverJsonPath = join(repoRoot, "server.json");
  assert.ok(existsSync(serverJsonPath), `server.json must exist at the monorepo root (${serverJsonPath})`);

  const serverJson = JSON.parse(readFileSync(serverJsonPath, "utf8")) as {
    version?: string;
    packages?: Array<{
      identifier?: string;
      version?: string;
      runtimeArguments?: Array<{ type?: string; value?: string }>;
    }>;
  };
  const pkg = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
    version?: string;
  };
  const skillVersion = pkg.version;
  assert.ok(skillVersion, "packages/skill/package.json must have a version");

  assert.equal(
    serverJson.version,
    skillVersion,
    `server.json.version (${serverJson.version}) must match packages/skill/package.json.version (${skillVersion})`
  );

  const npmPackageEntry = serverJson.packages?.find((p) => p.identifier === "@lab94/frenchie");
  assert.ok(npmPackageEntry, "server.json.packages must include an entry for @lab94/frenchie");
  assert.equal(
    npmPackageEntry?.version,
    skillVersion,
    `server.json.packages[@lab94/frenchie].version (${npmPackageEntry?.version}) must match package.json.version (${skillVersion})`
  );

  // runtimeArguments must pin the version-tagged package spec — unpinned
  // would let npx serve a stale cached bundle on the reviewer's machine
  // (the same class of bug that shipped in 0.3.0).
  const args = npmPackageEntry?.runtimeArguments ?? [];
  const pinnedSpec = `@lab94/frenchie@${skillVersion}`;
  assert.ok(
    args.some((a) => a.value === pinnedSpec),
    `server.json runtimeArguments must contain the pinned package spec "${pinnedSpec}". Found args: ${JSON.stringify(args)}`
  );
});

test("skill ships a LICENSE file and lists it in package files", () => {
  const licensePath = join(packageDirectory, "LICENSE");
  assert.ok(existsSync(licensePath), "packages/skill/LICENSE must exist so it ships in the npm tarball");
  const license = readFileSync(licensePath, "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /LAB94 Co\., Ltd\./);

  const packageJson = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
    files?: string[];
  };
  assert.ok(
    packageJson.files?.includes("LICENSE"),
    "LICENSE must appear in package.json files array"
  );
});

test("README leads with the stdio install command and keeps the HTTP fallback section", () => {
  const readme = readFileSync(join(packageDirectory, "README.md"), "utf8");

  assert.match(readme, /https:\/\/getfrenchie\.dev\/brand\/frenchie-readme-wordmark\.svg/);
  assert.match(readme, /Frenchie — your agent's best friend\./);
  assert.match(readme, /npx @lab94\/frenchie install --api-key/);
  assert.match(readme, /--agent antigravity\s+--global --api-key/);
  assert.match(readme, /image generation/i);
  assert.match(readme, /generate_image/);
  assert.match(readme, /20 credits per image/i);
  assert.match(readme, /Hosted agents/);
  assert.match(readme, /https:\/\/mcp\.getfrenchie\.dev/);
  assert.match(readme, /support@getfrenchie\.dev/);
});

test("package metadata and registry files advertise the current capability set", () => {
  const packageJson = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
    description?: string;
    files?: string[];
    keywords?: string[];
    mcpName?: string;
    version?: string;
  };
  const smithery = readFileSync(join(packageDirectory, "smithery.yaml"), "utf8");
  const serverJson = JSON.parse(
    readFileSync(join(repoRoot, "server.json"), "utf8")
  ) as {
    name?: string;
    description?: string;
    version?: string;
    packages?: Array<{
      identifier?: string;
      version?: string;
      runtimeArguments?: Array<{ value?: string }>;
    }>;
  };

  assert.equal(packageJson.mcpName, MCP_REGISTRY_NAME);
  assert.match(packageJson.description ?? "", /stdio MCP server/i);
  assert.match(packageJson.description ?? "", /image generation/i);
  assert.ok(packageJson.files?.includes("smithery.yaml"));
  assert.ok(existsSync(join(packageDirectory, "smithery.yaml")));
  assert.ok(packageJson.keywords?.includes("multimodal"));
  assert.ok(packageJson.keywords?.includes("image-generation"));
  assert.ok(packageJson.keywords?.includes("text-to-image"));

  assert.match(smithery, /image generation/i);
  assert.match(smithery, /@lab94\/frenchie@latest/);
  assert.match(smithery, /text-to-image/i);

  const npmPackage = serverJson.packages?.find((entry) => entry.identifier === "@lab94/frenchie");
  assert.equal(serverJson.name, MCP_REGISTRY_NAME);
  assert.match(serverJson.description ?? "", /image generation/i);
  assert.equal(serverJson.version, packageJson.version);
  assert.equal(npmPackage?.version, packageJson.version);
  assert.deepEqual(
    (npmPackage?.runtimeArguments ?? []).map((argument) => argument.value),
    ["-y", `@lab94/frenchie@${packageJson.version}`, "mcp"]
  );
});


test("published skill docs stay transport-aware and document both stdio and HTTP", () => {
  const packageInstructions = readFileSync(join(packageDirectory, "instructions.md"), "utf8");
  const packageCommands = readFileSync(join(packageDirectory, "commands.md"), "utf8");
  const skillInstructions = readFileSync(join(packageDirectory, "skills", "frenchie", "SKILL.md"), "utf8");
  const ocrCommand = readFileSync(
    join(packageDirectory, "skills", "frenchie", "commands", "ocr.md"),
    "utf8"
  );
  const transcriptionCommand = readFileSync(
    join(packageDirectory, "skills", "frenchie", "commands", "transcribe.md"),
    "utf8"
  );
  const config = readFileSync(join(packageDirectory, "config.md"), "utf8");

  // HTTP rules must survive — web/sandbox agents still use HTTP mode.
  assert.match(packageInstructions, /NEVER send `file_path`/);
  assert.match(packageCommands, /NEVER send `file_path`/);
  assert.match(packageInstructions, /HTTP mode MUST persist the final Markdown to `\.frenchie\/\{name\}\/result\.md`/);
  assert.match(skillInstructions, /upload_file/);
  assert.match(skillInstructions, /NEVER send `file_path`/);
  assert.match(ocrCommand, /NEVER send `file_path`/);
  assert.match(transcriptionCommand, /NEVER send `file_path`/);
  assert.match(config, /https:\/\/mcp\.getfrenchie\.dev/);

  // HTTP slash-command docs must stay on the MCP tool contract, not the raw REST presign route.
  assert.match(packageCommands, /Call the `upload_file` MCP tool/);
  assert.doesNotMatch(packageCommands, /POST https:\/\/api\.getfrenchie\.dev\/uploads\/presign/);
  assert.match(ocrCommand, /Call `upload_file`/);
  assert.match(transcriptionCommand, /Call `upload_file`/);

  // Stdio docs must reflect the actual metadata-only contract.
  assert.match(packageInstructions, /metadata-only/i);
  assert.match(packageInstructions, /savedTo/);
  assert.doesNotMatch(packageInstructions, /return the Markdown directly because the local MCP server already saved/i);
  assert.doesNotMatch(packageInstructions, /return the Markdown transcript directly because the local MCP server already saved/i);
  assert.match(ocrCommand, /savedTo/);
  assert.match(transcriptionCommand, /savedTo/);
  assert.doesNotMatch(ocrCommand, /return the Markdown after the tool finishes/i);
  assert.doesNotMatch(transcriptionCommand, /return the Markdown transcript after the tool finishes/i);

  // New stdio-first wording should be present in the canonical skill.
  assert.match(skillInstructions, /stdio/);
  // Example configs in config.md must show a pinned package spec so users who
  // hand-copy the example don't end up with npx serving a stale cached bundle.
  assert.match(config, /\[\"-y\", \"@lab94\/frenchie@\d+\.\d+\.\d+\", \"mcp\"\]/);
});

test("setup command advertises stdio as recommended and keeps HTTP as fallback", () => {
  const result = spawnSync("node", [join(packageDirectory, "bin", "install.cjs"), "setup"], {
    cwd: packageDirectory,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Recommended \(stdio/i);
  assert.match(result.stdout, /npx @lab94\/frenchie install --api-key fr_/);
  assert.match(result.stdout, /Antigravity\s+→ ~\/\.gemini\/antigravity\/mcp_config\.json \(requires --global\)/);
  assert.match(result.stdout, /For hosted agents/);
  assert.match(result.stdout, /https:\/\/mcp\.getfrenchie\.dev/);
  assert.doesNotMatch(result.stdout, /For hosted agents[\s\S]*Antigravity/);
});

test("install without a detected tested agent falls back to the generic agent skill target", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-install-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-install-home-"));
  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install", "--dry-run"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /No tested agent markers found/i);
  assert.match(result.stdout, /\.agent\/skills\/frenchie/);
  assert.doesNotMatch(result.stdout, /\.claude\/commands\/ocr\.md/);
});

test("install auto-detects Codex when AGENTS.md is present and writes project-scoped MCP config", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-codex-"));
  await writeFile(join(projectDirectory, "AGENTS.md"), "# My project\n");

  const result = spawnSync(
    "node",
    [
      join(packageDirectory, "bin", "install.cjs"),
      "install",
      "--api-key",
      "fr_TEST_KEY"
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[Codex\]/);
  assert.match(result.stdout, /\.agents\/skills\/frenchie\/SKILL\.md/);
  assert.match(result.stdout, /\.codex\/config\.toml/);

  // Project-scoped Codex MCP config should exist with the api key inlined.
  const tomlPath = join(projectDirectory, ".codex", "config.toml");
  assert.ok(existsSync(tomlPath), "project .codex/config.toml should exist");
  const toml = readFileSync(tomlPath, "utf8");
  assert.match(toml, /\[mcp_servers\.frenchie\]/);
  // command is resolved to an absolute path at install time so GUI-launched
  // agents (Antigravity, Claude Desktop, …) can spawn the server even without
  // inheriting shell PATH. Bare "npx" is the fallback; either is acceptable.
  assert.match(toml, /command = "(?:[^"]*[\\/])?npx(?:\.cmd)?"/);
  // Package spec is pinned to the installer's own version so npx can't serve
  // a stale cached bundle (the 0.3.0 stdio-metadata bug).
  assert.match(toml, /args = \["-y", "@lab94\/frenchie@\d+\.\d+\.\d+", "mcp"\]/);
  assert.match(toml, /\[mcp_servers\.frenchie\.env\]/);
  assert.match(toml, /PATH = "/);
  assert.match(toml, /FRENCHIE_API_KEY = "fr_TEST_KEY"/);

  // Codex-native skill file should be copied into .agents/skills/frenchie/
  const skillPath = join(projectDirectory, ".agents", "skills", "frenchie", "SKILL.md");
  assert.ok(existsSync(skillPath), ".agents/skills/frenchie/SKILL.md should exist");
});

test("install does not auto-detect Antigravity — it is opt-in only via --agent antigravity --global", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-antigravity-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-antigravity-home-"));
  // Even with ~/.gemini/antigravity/ present, Antigravity must not be auto-detected.
  await mkdir(join(fakeHome, ".gemini", "antigravity"), { recursive: true });

  const result = spawnSync(
    "node",
    [
      join(packageDirectory, "bin", "install.cjs"),
      "install",
      "--dry-run"
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /\[Antigravity\]/);
  assert.match(result.stdout, /No tested agent markers found/i);
});

test("install --agent antigravity --global writes the Antigravity stdio config into ~/.gemini/antigravity/mcp_config.json", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-antigravity-global-project-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-antigravity-global-home-"));

  const result = spawnSync(
    "node",
    [
      join(packageDirectory, "bin", "install.cjs"),
      "install",
      "--agent",
      "antigravity",
      "--global",
      "--api-key",
      "fr_TEST_KEY"
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[Antigravity\]/);
  assert.match(result.stdout, /\.gemini\/antigravity\/mcp_config\.json/);

  const configPath = join(fakeHome, ".gemini", "antigravity", "mcp_config.json");
  assert.ok(existsSync(configPath), "expected ~/.gemini/antigravity/mcp_config.json to exist");
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
    mcpServers: {
      frenchie?: {
        command?: string;
        args?: string[];
        env?: { FRENCHIE_API_KEY?: string; PATH?: string };
      };
    };
  };

  // Absolute `npx` path lets GUI-launched Antigravity spawn the server even
  // without inheriting shell PATH (fix for the "exec: npx not found" /
  // "env: node: No such file or directory" failures observed on macOS).
  assert.match(parsed.mcpServers.frenchie?.command ?? "", /(?:^|[\\/])npx(?:\.cmd)?$/);
  // Args must pin the package spec — unpinned lets npx serve whatever is
  // cached, which is how 0.3.0's stdio-metadata contract got shadowed by
  // stale 0.2.x bundles.
  const installerVersion = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")).version as string;
  assert.deepEqual(parsed.mcpServers.frenchie?.args, ["-y", `@lab94/frenchie@${installerVersion}`, "mcp"]);
  assert.equal(parsed.mcpServers.frenchie?.env?.FRENCHIE_API_KEY, "fr_TEST_KEY");
  // PATH must include Node's install dir so `#!/usr/bin/env node` inside npx resolves.
  assert.ok(parsed.mcpServers.frenchie?.env?.PATH, "env.PATH should be populated");
});

test("install --agent codex is idempotent and preserves neighbor TOML blocks on rerun", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-codex-rerun-"));
  await writeFile(join(projectDirectory, "AGENTS.md"), "# Project\n");
  await mkdir(join(projectDirectory, ".codex"), { recursive: true });
  // Seed an existing TOML that has a frenchie block with a nested .env subtable
  // sandwiched between two unrelated mcp_servers. A naive regex fix would
  // replace only the outer header, orphan the nested subtable, and then append
  // a second frenchie block on the rerun.
  const initialToml = [
    "[mcp_servers.other]",
    'command = "other-mcp"',
    "",
    "[mcp_servers.frenchie]",
    'command = "npx"',
    'args = ["-y", "@lab94/frenchie", "mcp"]',
    "",
    "[mcp_servers.frenchie.env]",
    'FRENCHIE_API_KEY = "fr_OLD_KEY"',
    "",
    "[mcp_servers.another]",
    'command = "another-mcp"',
    ""
  ].join("\n");
  await writeFile(join(projectDirectory, ".codex", "config.toml"), initialToml);

  const run = () =>
    spawnSync(
      "node",
      [
        join(packageDirectory, "bin", "install.cjs"),
        "install",
        "--agent",
        "codex",
        "--api-key",
        "fr_NEW_KEY"
      ],
      { cwd: projectDirectory, encoding: "utf8" }
    );

  const first = run();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = run();
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const toml = readFileSync(join(projectDirectory, ".codex", "config.toml"), "utf8");

  // Neighbor blocks preserved
  assert.match(toml, /\[mcp_servers\.other\]/);
  assert.match(toml, /\[mcp_servers\.another\]/);

  // Key rotated to the new value; old key no longer appears
  assert.match(toml, /FRENCHIE_API_KEY = "fr_NEW_KEY"/);
  assert.doesNotMatch(toml, /FRENCHIE_API_KEY = "fr_OLD_KEY"/);

  // Exactly one frenchie outer header + one nested .env — no duplicates after rerun
  const headerMatches = toml.match(/\[mcp_servers\.frenchie\]/g) ?? [];
  const envMatches = toml.match(/\[mcp_servers\.frenchie\.env\]/g) ?? [];
  assert.equal(headerMatches.length, 1, "expected exactly one [mcp_servers.frenchie] block");
  assert.equal(envMatches.length, 1, "expected exactly one [mcp_servers.frenchie.env] block");
});

test("install --agent zed without --global refuses to touch $HOME and prints the target path", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-zed-"));

  const result = spawnSync(
    "node",
    [
      join(packageDirectory, "bin", "install.cjs"),
      "install",
      "--agent",
      "zed",
      "--api-key",
      "fr_TEST_KEY"
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[Zed\]/);
  assert.match(result.stdout, /skipped MCP config: no project-level MCP path — rerun with --global/);
});

test("install auto-detects Claude Code project markers", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-claude-"));
  await mkdir(join(projectDirectory, ".claude"), { recursive: true });
  await writeFile(join(projectDirectory, ".claude", "settings.json"), "{}");

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install", "--dry-run"],
    {
      cwd: projectDirectory,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[Claude Code\]/);
  assert.match(result.stdout, /copy \.claude\/commands/);
});

test("install.cjs does not ship malformed Windows PATH defaults", async () => {
  // Regression guard for a shipped bug: the Windows branch of resolvePathEnv
  // had `C\\:\\Program Files\\nodejs` etc., which after string-escape produces
  // literal runtime strings `C\:\Program Files\nodejs` — not valid Windows
  // paths. Drive letters on Windows are `C:\`, not `C\:\`.
  const installerSource = readFileSync(join(packageDirectory, "bin", "install.cjs"), "utf8");
  assert.doesNotMatch(
    installerSource,
    /C\\\\:/,
    "resolvePathEnv should not contain backslash-before-colon sequences — Windows drive letters are `C:\\\\`, not `C\\\\:\\\\`"
  );
});

test("install warns when a legacy 0.1.x HTTP frenchie entry shadows the new stdio config", async () => {
  // Seed a project .mcp.json that looks like a pre-0.2 HTTP Frenchie install.
  // Without the warning, the user would re-run install, restart their agent,
  // and still see upload+curl behavior because the old entry wins precedence.
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-legacy-"));
  await mkdir(join(projectDirectory, ".claude"), { recursive: true });
  await writeFile(
    join(projectDirectory, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        frenchie: {
          url: "https://mcp.getfrenchie.dev",
          headers: { Authorization: "Bearer fr_old" }
        }
      }
    })
  );

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install", "--dry-run"],
    { cwd: projectDirectory, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = result.stdout + result.stderr;
  assert.match(output, /Legacy Frenchie HTTP config detected/i);
  assert.match(output, /\.mcp\.json/);
  assert.match(output, /docs#migrating/);
});

test("install reuses FRENCHIE_API_KEY from an existing project MCP config (JSON)", async () => {
  // API keys are shown only once at creation. Re-running `install` without
  // --api-key must recover the key from the current MCP config so the
  // upgrade path stays one command long. Regression guard against the
  // 0.3.0 → 0.3.1 experience where re-running install without the key
  // silently skipped the MCP rewrite.
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-key-reuse-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-key-reuse-home-"));
  // Seed a pre-existing .mcp.json with a stored key and an unpinned args
  // array (what a 0.3.0 install looked like). We assert the key is reused
  // *and* the 0.3.1 pin is rewritten.
  await writeFile(
    join(projectDirectory, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        frenchie: {
          command: "npx",
          args: ["-y", "@lab94/frenchie", "mcp"],
          env: { FRENCHIE_API_KEY: "fr_REUSE_METEST_abcd1234" }
        }
      }
    })
  );
  await mkdir(join(projectDirectory, ".claude"), { recursive: true });

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome,
        // Explicitly unset FRENCHIE_API_KEY so env-fallback can't satisfy
        // the resolver before the config-scan step runs.
        FRENCHIE_API_KEY: ""
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  // Key is logged with the last-4 redaction pattern.
  assert.match(result.stdout, /Reusing API key fr_…1234/, `expected redacted reuse log; got: ${result.stdout}`);
  // And never prints the full key.
  assert.doesNotMatch(result.stdout, /fr_REUSE_METEST_abcd1234/, "full API key must never be logged");

  // MCP config was rewritten with the 0.3.1 pin AND the original key.
  const rewritten = JSON.parse(readFileSync(join(projectDirectory, ".mcp.json"), "utf8"));
  assert.equal(rewritten.mcpServers.frenchie.env.FRENCHIE_API_KEY, "fr_REUSE_METEST_abcd1234");
  const installerVersion = JSON.parse(
    readFileSync(join(packageDirectory, "package.json"), "utf8")
  ).version as string;
  assert.deepEqual(rewritten.mcpServers.frenchie.args, ["-y", `@lab94/frenchie@${installerVersion}`, "mcp"]);
});

test("install reuses FRENCHIE_API_KEY from an existing Codex TOML config", async () => {
  // Same contract as the JSON case, exercised against the line-based TOML
  // reader.
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-toml-reuse-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-toml-reuse-home-"));
  await writeFile(join(projectDirectory, "AGENTS.md"), "# project\n");
  await mkdir(join(projectDirectory, ".codex"), { recursive: true });
  await writeFile(
    join(projectDirectory, ".codex", "config.toml"),
    [
      "[mcp_servers.frenchie]",
      'command = "npx"',
      'args = ["-y", "@lab94/frenchie", "mcp"]',
      "",
      "[mcp_servers.frenchie.env]",
      'FRENCHIE_API_KEY = "fr_TOML_REUSE_wxyz9876"'
    ].join("\n")
  );

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome,
        FRENCHIE_API_KEY: ""
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Reusing API key fr_…9876/, `expected redacted reuse log; got: ${result.stdout}`);

  const toml = readFileSync(join(projectDirectory, ".codex", "config.toml"), "utf8");
  assert.match(toml, /FRENCHIE_API_KEY = "fr_TOML_REUSE_wxyz9876"/);
});

test("install --api-key overrides a config-scanned key", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-override-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-override-home-"));
  await writeFile(
    join(projectDirectory, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        frenchie: {
          command: "npx",
          args: ["-y", "@lab94/frenchie", "mcp"],
          env: { FRENCHIE_API_KEY: "fr_OLD_KEY_should_not_win" }
        }
      }
    })
  );
  await mkdir(join(projectDirectory, ".claude"), { recursive: true });

  const result = spawnSync(
    "node",
    [
      join(packageDirectory, "bin", "install.cjs"),
      "install",
      "--api-key",
      "fr_NEW_ROTATED_KEY"
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, FRENCHIE_API_KEY: "" }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  // CLI flag wins — no reuse log at all.
  assert.doesNotMatch(result.stdout, /Reusing API key/);
  const rewritten = JSON.parse(readFileSync(join(projectDirectory, ".mcp.json"), "utf8"));
  assert.equal(rewritten.mcpServers.frenchie.env.FRENCHIE_API_KEY, "fr_NEW_ROTATED_KEY");
});

test("FRENCHIE_API_KEY env beats a config-scanned key", async () => {
  // Sourcing order contract: --api-key > FRENCHIE_API_KEY env > config
  // scan > TTY > null. Without a test that an env-var wins over config
  // scan, someone could swap the order in `resolveApiKey()` and CI
  // wouldn't catch it — rotation flows (`FRENCHIE_API_KEY=fr_new install`)
  // would silently keep writing the old key.
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-env-override-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-env-override-home-"));
  await writeFile(
    join(projectDirectory, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        frenchie: {
          command: "npx",
          args: ["-y", "@lab94/frenchie", "mcp"],
          env: { FRENCHIE_API_KEY: "fr_CONFIG_KEY_should_not_win" }
        }
      }
    })
  );
  await mkdir(join(projectDirectory, ".claude"), { recursive: true });

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, FRENCHIE_API_KEY: "fr_ENV_WINS_abcd1234" }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  // Env shortcut returned before the config scan ran — no reuse log.
  assert.doesNotMatch(result.stdout, /Reusing API key/);
  const rewritten = JSON.parse(readFileSync(join(projectDirectory, ".mcp.json"), "utf8"));
  assert.equal(rewritten.mcpServers.frenchie.env.FRENCHIE_API_KEY, "fr_ENV_WINS_abcd1234");
});

test("project-scoped config key beats user-global when both exist", async () => {
  // Probe order starts with project-scoped paths so `install` in a
  // project prefers that project's own key. This test pins the order
  // down — a seemingly-harmless reshuffle of `jsonMcpConfigPaths()`
  // (putting `~/.claude.json` before `.mcp.json`) would silently flip
  // which key a user sees reused when both are present.
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-precedence-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-precedence-home-"));
  await writeFile(
    join(projectDirectory, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        frenchie: {
          command: "npx",
          args: ["-y", "@lab94/frenchie", "mcp"],
          env: { FRENCHIE_API_KEY: "fr_PROJECT_KEY_wxyz1111" }
        }
      }
    })
  );
  await mkdir(join(projectDirectory, ".claude"), { recursive: true });

  // Seed a different key at the user-global path (~/.claude.json). If
  // probe order were reversed, this would win and the test would fail.
  await writeFile(
    join(fakeHome, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        frenchie: {
          command: "npx",
          args: ["-y", "@lab94/frenchie", "mcp"],
          env: { FRENCHIE_API_KEY: "fr_HOME_KEY_abcd2222" }
        }
      }
    })
  );

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, FRENCHIE_API_KEY: "" }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /Reusing API key fr_…1111/,
    `expected project key (suffix 1111) to win; got: ${result.stdout}`
  );
  // Redaction also implies the home key (suffix 2222) was never selected.
  assert.doesNotMatch(result.stdout, /fr_…2222/);
});

test("install ignores a malformed API key in the existing config", async () => {
  // A seed key that doesn't match /^fr_[A-Za-z0-9_-]+$/ (e.g. a placeholder
  // the user pasted in, or a different vendor's key) must be ignored
  // rather than propagated. Without this guard the installer could
  // rewrite valid configs with garbage.
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-malformed-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "frenchie-skill-malformed-home-"));
  await writeFile(
    join(projectDirectory, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        frenchie: {
          command: "npx",
          args: ["-y", "@lab94/frenchie", "mcp"],
          env: { FRENCHIE_API_KEY: "REPLACE_ME_PLACEHOLDER" }
        }
      }
    })
  );
  await mkdir(join(projectDirectory, ".claude"), { recursive: true });

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "install"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, FRENCHIE_API_KEY: "" }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Reusing API key/);
  // With no key sourced and no TTY in the child process, the installer
  // prints the "no API key" warning and skips the MCP rewrite.
  assert.match(result.stdout + result.stderr, /No API key provided/);
});

test("install pins the MCP package spec to the installer's own version so npx cannot spawn stale cached bundles", async () => {
  // Regression guard for the 0.3.0 stdio-metadata contract: with an unpinned
  // `@lab94/frenchie`, `npx -y @lab94/frenchie mcp` would happily reuse a
  // cached 0.2.x bundle and return full markdown inline, defeating the whole
  // point of 0.3.0. Pinning to the installer's own version keeps the spawned
  // server on the same release the installer was shipped with.
  const projectDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-pin-"));
  await writeFile(join(projectDirectory, "AGENTS.md"), "# project\n");

  const result = spawnSync(
    "node",
    [
      join(packageDirectory, "bin", "install.cjs"),
      "install",
      "--api-key",
      "fr_PIN_TEST"
    ],
    { cwd: projectDirectory, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const installerVersion = JSON.parse(
    readFileSync(join(packageDirectory, "package.json"), "utf8")
  ).version as string;

  // Codex TOML path exercises upsertCodexTomlBlock
  const toml = readFileSync(join(projectDirectory, ".codex", "config.toml"), "utf8");
  assert.match(
    toml,
    new RegExp(`args = \\["-y", "@lab94/frenchie@${installerVersion.replace(/\./g, "\\.")}", "mcp"\\]`),
    `Codex TOML should pin to @lab94/frenchie@${installerVersion}`
  );
  assert.doesNotMatch(
    toml,
    /args = \["-y", "@lab94\/frenchie", "mcp"\]/,
    "Codex TOML must not emit an unpinned package spec"
  );
});

test("mcp --help exits 0 quickly with non-empty stdout (preflight safety)", () => {
  // Some agents (observed: VS Code Copilot) preflight the stdio binary with
  // `--help` and treat any hang as a failure. The subcommand must short-circuit
  // before booting the stdio server.
  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "mcp", "--help"],
    { cwd: packageDirectory, encoding: "utf8", timeout: 5_000 }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /stdio MCP server/i);
  assert.match(result.stdout, /--selftest/);
});

test("mcp --version prints the package version", () => {
  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "mcp", "--version"],
    { cwd: packageDirectory, encoding: "utf8", timeout: 5_000 }
  );

  const pkg = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
    version?: string;
  };
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), pkg.version);
});

test("mcp --selftest boots the stdio server and lists the expected tools", () => {
  // Require the bundled dist/mcp.cjs — if it's missing the test fails loudly,
  // not silently. The npm-pack test above runs `pnpm build` so the bundle is
  // always present in CI. A fresh local checkout that runs `pnpm test`
  // directly will get a clear error pointing at the missing bundle rather
  // than a false pass.
  const bundlePath = join(packageDirectory, "dist", "mcp.cjs");
  assert.ok(
    existsSync(bundlePath),
    `dist/mcp.cjs missing — run \`pnpm --filter @lab94/frenchie build\` before running this test, or let CI's pack step build for you.`
  );

  const result = spawnSync(
    "node",
    [join(packageDirectory, "bin", "install.cjs"), "mcp", "--selftest"],
    { cwd: packageDirectory, encoding: "utf8", timeout: 15_000 }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS/);
  assert.match(result.stdout, /ocr_to_markdown/);
  assert.match(result.stdout, /transcribe_to_markdown/);
});

test("npm pack dry-run includes the bundled mcp binary and skill docs", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-pack-"));
  const cacheDirectory = await mkdtemp(join(tmpdir(), "frenchie-skill-pack-cache-"));
  // Build from the package directory so the test runs identically in the
  // monorepo (cwd = packages/skill) and in the synced public mirror repo
  // (cwd = repo root). `--filter` would require a workspace config the
  // public mirror doesn't have.
  const build = spawnSync("pnpm", ["build"], {
    cwd: packageDirectory,
    encoding: "utf8"
  });

  assert.equal(build.status, 0, build.stderr || build.stdout);

  const result = spawnSync(
    "npm",
    ["pack", "--json", "--dry-run", "--pack-destination", outputDirectory],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: cacheDirectory
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const parsed = JSON.parse(result.stdout) as Array<{ files?: Array<{ path: string }> }>;
  const packedFiles = new Set(parsed[0]?.files?.map((file) => file.path));

  assert.ok(packedFiles.has("LICENSE"), "LICENSE must ship in the npm tarball — MIT is required for PulseMCP/Smithery submission");
  assert.ok(packedFiles.has("smithery.yaml"), "smithery.yaml must ship so Smithery's npm-scan path can pick up the config schema without hitting the HTTP server card");
  assert.ok(packedFiles.has("dist/index.js"));
  assert.ok(packedFiles.has("dist/index.cjs"));
  assert.ok(packedFiles.has("dist/index.d.ts"));
  assert.ok(packedFiles.has("dist/mcp.cjs"), "stdio MCP bundle should be packed");
  assert.ok(packedFiles.has("dist/mcp-runtime.js"));
  assert.ok(packedFiles.has("instructions.md"));
  assert.ok(packedFiles.has("commands.md"));
  assert.ok(packedFiles.has("config.md"));
  assert.ok(packedFiles.has("README.md"));
  assert.ok(packedFiles.has("MIGRATION.md"), "MIGRATION.md should ship so users can read it via `npm view @lab94/frenchie`");
  assert.ok(packedFiles.has("skills/frenchie/SKILL.md"));
});
