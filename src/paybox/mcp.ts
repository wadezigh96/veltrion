import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type PayBoxMcpToolSummary = {
  name: string;
  description: string;
};

export type PayBoxMcpDiscoveryResult = {
  connection: "discovered" | "not-configured" | "error";
  endpoint: "https://api.paybox.sh/mcp";
  transport: "mcp-streamable-http";
  toolCount: number;
  tools: PayBoxMcpToolSummary[];
  executionEnabled: false;
  detail: string;
};

type RawTool = { name?: unknown; description?: unknown };
type RawListTools = { tools?: unknown };

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().slice(0, 160);
}

export function summarizeMcpTools(value: unknown): PayBoxMcpToolSummary[] {
  if (!value || typeof value !== "object") return [];
  const tools = (value as RawListTools).tools;
  if (!Array.isArray(tools)) return [];
  return tools.slice(0, 100).map((raw: RawTool, index: number) => ({
    name: cleanText(raw?.name, `unknown_tool_${index + 1}`),
    description: cleanText(raw?.description, "No description supplied.")
  }));
}

/**
 * Performs only MCP list_tools discovery. It never calls any provider tool.
 * Supply an OAuth access token through the local process environment; never
 * pass it as an MCP tool argument or print it.
 */
export async function discoverPayBoxMcpTools(
  accessToken = process.env.PAYBOX_ACCESS_TOKEN
): Promise<PayBoxMcpDiscoveryResult> {
  if (!accessToken?.trim()) {
    return {
      connection: "not-configured",
      endpoint: "https://api.paybox.sh/mcp",
      transport: "mcp-streamable-http",
      toolCount: 0,
      tools: [],
      executionEnabled: false,
      detail: "Direct PayBox MCP is not configured. Set PAYBOX_ACCESS_TOKEN locally using the supported OAuth flow; no network request was made."
    };
  }

  const client = new Client({ name: "veltrion-paybox-discovery", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://api.paybox.sh/mcp"),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    }
  );

  try {
    // The SDK transport types have an exactOptionalPropertyTypes mismatch on sessionId;\n    // the runtime transport implements the same MCP Transport contract.\n    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    const raw: unknown = await client.listTools();
    const tools = summarizeMcpTools(raw);
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as RawListTools).tools)) {
      return {
        connection: "error",
        endpoint: "https://api.paybox.sh/mcp",
        transport: "mcp-streamable-http",
        toolCount: 0,
        tools: [],
        executionEnabled: false,
        detail: "PayBox MCP returned an unexpected list_tools response. No provider tool was called."
      };
    }
    return {
      connection: "discovered",
      endpoint: "https://api.paybox.sh/mcp",
      transport: "mcp-streamable-http",
      toolCount: tools.length,
      tools,
      executionEnabled: false,
      detail: "Direct MCP handshake and list_tools discovery succeeded. No provider tool was called and execution remains disabled."
    };
  } catch {
    return {
      connection: "error",
      endpoint: "https://api.paybox.sh/mcp",
      transport: "mcp-streamable-http",
      toolCount: 0,
      tools: [],
      executionEnabled: false,
      detail: "Direct PayBox MCP connection could not be verified. Authentication, OAuth grants, or transport may need setup. Provider error details were suppressed."
    };
  } finally {
    try {
      await client.close();
    } catch {
      // Best-effort cleanup only; do not mask the safe discovery result.
    }
  }
}
