import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../metadata.js";
import { ApiClient } from "./api-client.js";
import { registerTools } from "./tools.js";

const DEFAULT_SMART_WAIT_INTERVAL_MS = 3000;
const DEFAULT_SMART_WAIT_TIMEOUT_MS = 90_000;

export interface McpServerOptions {
  apiUrl: string;
  defaultApiKey?: string;
  smartWaitIntervalMs?: number;
  smartWaitTimeoutMs?: number;
  outputDir?: string;
  transportMode?: "stdio" | "http";
  fetchFn?: typeof fetch;
}

export interface HttpApp {
  app: Express;
  close: () => Promise<void>;
}

export type McpServerFactory = (httpApiKey?: string) => McpServer;

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION
  });

  registerTools(server, {
    apiClient: new ApiClient({
      apiUrl: options.apiUrl,
      fetchFn: options.fetchFn
    }),
    defaultApiKey: options.defaultApiKey,
    smartWaitIntervalMs: options.smartWaitIntervalMs ?? DEFAULT_SMART_WAIT_INTERVAL_MS,
    smartWaitTimeoutMs: options.smartWaitTimeoutMs ?? DEFAULT_SMART_WAIT_TIMEOUT_MS,
    outputDir: options.outputDir ?? process.cwd(),
    transportMode: options.transportMode ?? "stdio"
  });

  return server;
}

/** How long an HTTP session may remain idle before it is forcibly evicted. */
const SESSION_IDLE_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** How often the idle-session reaper runs. */
const SESSION_REAP_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** Timestamp (ms) of the last inbound request for this session. */
  lastActivityAt: number;
}

interface SseSessionEntry {
  server: McpServer;
  transport: SSEServerTransport;
  lastActivityAt: number;
}

export function createHttpApp(createServer: McpServerFactory): HttpApp {
  const sessionEntries = new Map<string, SessionEntry>();
  const sseSessionEntries = new Map<string, SseSessionEntry>();

  // Periodically evict sessions that have been idle longer than SESSION_IDLE_TTL_MS.
  // This prevents memory from growing unboundedly when clients disconnect
  // without sending a proper close message.
  const reapInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessionEntries) {
      if (now - entry.lastActivityAt > SESSION_IDLE_TTL_MS) {
        sessionEntries.delete(id);
        void Promise.all([entry.transport.close(), entry.server.close()]).catch(() => {
          // Best-effort cleanup; ignore errors from already-closed sessions.
        });
      }
    }
    for (const [id, entry] of sseSessionEntries) {
      if (now - entry.lastActivityAt > SESSION_IDLE_TTL_MS) {
        sseSessionEntries.delete(id);
        void Promise.all([entry.transport.close(), entry.server.close()]).catch(() => {
          // Best-effort cleanup; ignore errors from already-closed sessions.
        });
      }
    }
  }, SESSION_REAP_INTERVAL_MS);

  // Prevent the interval from keeping the process alive after close().
  reapInterval.unref();

  const app = express();

  const mcpAllowedOrigins = new Set(
    (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  app.use(
    cors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => {
        if (!origin || mcpAllowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin not allowed by CORS"));
      },
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "mcp-session-id", "Authorization", "mcp-protocol-version"]
    })
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "frenchie-mcp",
      timestamp: new Date().toISOString()
    });
  });

  // ── Streamable HTTP transport (GET / POST / DELETE) ──────────────────────

  const handleMcpRequest: express.RequestHandler = async (req, res) => {
    if (req.method === "GET") {
      res.setHeader("Allow", "POST, DELETE");
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Method not allowed. Frenchie does not expose a standalone SSE stream on this endpoint."
        },
        id: null
      });
      return;
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      let session = sessionId ? sessionEntries.get(sessionId) : undefined;

      if (!session) {
        // Only POST initialize can create a new session
        if (req.method !== "POST" || sessionId || !isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: No valid session ID provided"
            },
            id: null
          });
          return;
        }

        const bearerToken = extractBearerToken(req.headers.authorization);
        const server = createServer(bearerToken);
        let capturedSessionId: string | undefined;
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            capturedSessionId = initializedSessionId;
            sessionEntries.set(initializedSessionId, {
              server,
              transport,
              lastActivityAt: Date.now()
            });
          }
        });

        transport.onclose = () => {
          transport.onclose = undefined;
          if (capturedSessionId) {
            sessionEntries.delete(capturedSessionId);
          }
        };

        await server.connect(transport);
        session = { server, transport, lastActivityAt: Date.now() };
      }

      // Refresh last-activity timestamp so the idle reaper does not evict an
      // actively-used session.
      session.lastActivityAt = Date.now();

      // GET/DELETE have no body — only pass req.body for POST
      const body = req.method === "POST" ? req.body : undefined;
      await session.transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error"
          },
          id: null
        });
      }
    }
  };

  app.get("/", handleMcpRequest);
  app.post("/", handleMcpRequest);
  app.delete("/", handleMcpRequest);

  // Keep /mcp as a compatibility alias so existing HTTP clients don't break
  app.get("/mcp", handleMcpRequest);
  app.post("/mcp", handleMcpRequest);
  app.delete("/mcp", handleMcpRequest);

  // ── Deprecated SSE transport ─────────────────────────────────────────────

  app.get("/sse", async (req, res) => {
    try {
      const bearerToken = extractBearerToken(req.headers.authorization);
      const server = createServer(bearerToken);
      const transport = new SSEServerTransport("/sse/message", res);

      // Send SSE keepalive comments every 15s to prevent proxies and clients
      // from dropping the connection during long-running tool operations
      // (smart-wait polling can block for up to 90s with no data sent).
      const keepaliveInterval = setInterval(() => {
        try {
          if (!res.writableEnded) {
            res.write(": keepalive\n\n");
          }
        } catch {
          clearInterval(keepaliveInterval);
        }
      }, 15_000);

      transport.onclose = () => {
        clearInterval(keepaliveInterval);
        // Nullify immediately to prevent recursive close loop:
        // transport.close → onclose → server.close → transport.close → …
        transport.onclose = undefined;
        sseSessionEntries.delete(transport.sessionId);
        void server.close().catch(() => {
          // Best-effort cleanup
        });
      };

      res.on("close", () => {
        clearInterval(keepaliveInterval);
      });

      sseSessionEntries.set(transport.sessionId, {
        server,
        transport,
        lastActivityAt: Date.now()
      });

      // server.connect() internally calls transport.start()
      await server.connect(transport);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).send(error instanceof Error ? error.message : "Internal server error");
      }
    }
  });

  app.post("/sse/message", async (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    const sseSession = sessionId ? sseSessionEntries.get(sessionId) : undefined;

    if (!sseSession) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    sseSession.lastActivityAt = Date.now();
    await sseSession.transport.handlePostMessage(req, res, req.body);
  });

  // ── App lifecycle ────────────────────────────────────────────────────────

  return {
    app,
    close: async () => {
      clearInterval(reapInterval);

      const streamableSessions = Array.from(sessionEntries.values());
      sessionEntries.clear();
      const sseSessions = Array.from(sseSessionEntries.values());
      sseSessionEntries.clear();

      // Nullify onclose handlers before tearing down to prevent recursive
      // close loops (transport.close → onclose → server.close → ...).
      for (const entry of streamableSessions) entry.transport.onclose = undefined;
      for (const entry of sseSessions) entry.transport.onclose = undefined;

      await Promise.all([
        ...streamableSessions.map(async ({ server, transport }) => {
          await transport.close();
          await server.close();
        }),
        ...sseSessions.map(async ({ server, transport }) => {
          await transport.close();
          await server.close();
        })
      ]);
    }
  };
}

export async function connectStdioServer(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  return match?.[1];
}

function isInitializeRequest(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  return (
    (payload as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    (payload as { method?: unknown }).method === "initialize"
  );
}
