import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/mcp-runtime.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: false,
    target: "node18",
    platform: "node"
  },
  {
    entry: ["src/mcp.ts"],
    format: ["cjs"],
    bundle: true,
    platform: "node",
    target: "node18",
    sourcemap: false,
    clean: false,
    outExtension() {
      return { js: ".cjs" };
    }
  }
]);
