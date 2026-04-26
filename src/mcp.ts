import { homedir } from "node:os";
import { connectStdioServer, createMcpServer } from "./mcp/server.js";

const DEFAULT_API_URL = "https://api.getfrenchie.dev";

function resolveApiUrl(): string {
  const explicit = process.env.FRENCHIE_API_URL;
  if (!explicit) return DEFAULT_API_URL;
  try {
    new URL(explicit);
  } catch {
    throw new Error(
      `Invalid FRENCHIE_API_URL: "${explicit}" — must be a valid URL (e.g. https://api.getfrenchie.dev)`
    );
  }
  return explicit;
}

function resolveOutputDir(): string {
  if (process.env.FRENCHIE_OUTPUT_DIR) return process.env.FRENCHIE_OUTPUT_DIR;
  const cwd = process.cwd();
  return cwd === "/" ? homedir() : cwd;
}

async function main(): Promise<void> {
  const apiUrl = resolveApiUrl();
  const outputDir = resolveOutputDir();

  await connectStdioServer(
    createMcpServer({
      apiUrl,
      defaultApiKey: process.env.FRENCHIE_API_KEY,
      outputDir,
      transportMode: "stdio"
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
