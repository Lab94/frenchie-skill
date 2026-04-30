export const SKILL_PACKAGE_NAME = "@lab94/frenchie";
export const MCP_SERVER_NAME = "frenchie-mcp";
export const MCP_SERVER_VERSION = "0.4.5";
export const MCP_REGISTRY_NAME = "io.github.Lab94/frenchie-skill";

export const SKILL_COMMANDS = [
  "/ocr <file>",
  "/transcribe <file>",
  "/extract <file>",
  "/generate-image <prompt>",
  "/frenchie-status"
] as const;

export const SKILL_ASSET_FILES = {
  instructions: "instructions.md",
  commands: "commands.md",
  config: "config.md",
  readme: "README.md"
} as const;
