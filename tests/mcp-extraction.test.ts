import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ApiClient } from "../src/mcp/api-client";
import { registerTools } from "../src/mcp/tools";

test("ApiClient.createExtractionJob posts to /jobs/extract", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new ApiClient({
    apiUrl: "https://api.example.test",
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ jobId: "job_extract", status: "queued", estimatedSeconds: 10 }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch
  });

  const result = await client.createExtractionJob("fr_test", {
    objectKey: "uploads/user_01/data.csv",
    mimeType: "text/csv"
  });

  assert.equal(result.jobId, "job_extract");
  assert.equal(requests[0]?.url, "https://api.example.test/jobs/extract");
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(requests[0]?.init.headers?.["authorization" as keyof HeadersInit], "Bearer fr_test");
  assert.equal(JSON.parse(String(requests[0]?.init.body)).mimeType, "text/csv");
});

test("registerTools exposes extract_to_markdown and forwards uploaded_file_reference", async () => {
  const callbacks = new Map<string, (args: unknown) => Promise<unknown>>();
  const configs = new Map<string, { outputSchema?: z.ZodRawShape }>();
  const server = {
    registerTool(name: string, config: { outputSchema?: z.ZodRawShape }, callback: (args: unknown) => Promise<unknown>) {
      configs.set(name, config);
      callbacks.set(name, callback);
    }
  };
  const calls: Array<{ objectKey: string; mimeType?: string }> = [];

  registerTools(server as never, {
    defaultApiKey: "fr_test",
    defaultLanguage: undefined,
    smartWaitIntervalMs: 1,
    smartWaitTimeoutMs: 1,
    outputDir: process.cwd(),
    transportMode: "http",
    apiClient: {
      createExtractionJob: async (_apiKey: string, input: { objectKey: string; mimeType?: string }) => {
        calls.push(input);
        return {
          jobId: "job_extract",
          status: "done",
          creditsUsed: 0.5,
          resultExpiresAt: "2026-04-28T00:00:00.000Z",
          result: { kind: "markdown", markdown: "| a |\n| --- |\n| b |" }
        };
      }
    } as never
  });

  const callback = callbacks.get("extract_to_markdown");
  assert.ok(callback, "extract_to_markdown should be registered");

  const result = await callback({ uploaded_file_reference: "uploads/user_01/data.csv" });

  assert.deepEqual(calls, [{ objectKey: "uploads/user_01/data.csv" }]);
  assert.match(JSON.stringify(result), /\\| b \\|/);

  const outputSchema = configs.get("extract_to_markdown")?.outputSchema;
  assert.ok(outputSchema, "extract_to_markdown should declare an output schema");
  z.object(outputSchema).parse({
    status: "done",
    jobId: "job_extract",
    creditsUsed: 0.5,
    result: { kind: "markdown", markdown: "| a |\n| --- |\n| b |" }
  });
});
