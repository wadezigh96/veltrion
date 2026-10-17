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
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    }
  );

  try {
    // The SDK transport types have an exactOptionalPropertyTypes mismatch on sessionId;
    // the runtime transport implements the same MCP Transport contract.
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
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


export type PayBoxWalletSummary = {
  credentialId: string;
  name: string;
  approvalMode: string;
  address?: string;
  chains: string[];
};

export type PayBoxWalletListResult = {
  connection: "read" | "not-configured" | "error";
  endpoint: "https://api.paybox.sh/mcp";
  wallets: PayBoxWalletSummary[];
  executionEnabled: false;
  detail: string;
};

type RawCredential = {
  credential_id?: unknown;
  credential?: { id?: unknown };
  name?: unknown;
  kind?: unknown;
  approval_mode?: unknown;
  approvalMode?: unknown;
  address?: unknown;
  chains?: unknown;
  metadata?: {
    address?: unknown;
    wallet_address?: unknown;
    chains?: unknown;
  };
};

function boundedString(value: unknown, fallback: string, max = 100): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().slice(0, max);
}

function normalizeChains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 20)
    .map(item => item.trim().slice(0, 80));
}

/** Exposes only allowlisted wallet metadata; excludes cards, secrets, raw payloads, and ungranted credentials. */
export function summarizePayBoxWallets(value: unknown): PayBoxWalletSummary[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { credentials?: unknown }).credentials;
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row): row is RawCredential => {
      if (!row || typeof row !== "object") return false;
      const kind = (row as RawCredential).kind;
      return typeof kind === "string" && kind.toLowerCase() === "wallet";
    })
    .slice(0, 50)
    .map((row, index) => {
      const address = row.metadata?.address ?? row.metadata?.wallet_address ?? row.address;
      const chains = row.metadata?.chains ?? row.chains;
      const summary: PayBoxWalletSummary = {
        credentialId: boundedString(row.credential_id ?? row.credential?.id, `unknown-${index + 1}`),
        name: boundedString(row.name, "Unnamed wallet"),
        approvalMode: boundedString(row.approval_mode ?? row.approvalMode, "unknown"),
        chains: normalizeChains(chains)
      };
      if (typeof address === "string" && address.trim()) {
        summary.address = address.trim().slice(0, 100);
      }
      return summary;
    });
}

function parseMcpToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const object = value as { structuredContent?: unknown; content?: unknown; isError?: unknown };
  if (object.isError === true) return null;
  if (object.structuredContent && typeof object.structuredContent === "object") return object.structuredContent;
  if (!Array.isArray(object.content)) return null;
  const textItem = object.content.find((item: unknown) =>
    Boolean(item && typeof item === "object" && (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string")
  ) as { text: string } | undefined;
  if (!textItem) return null;
  try {
    return JSON.parse(textItem.text) as unknown;
  } catch {
    return null;
  }
}

/** Calls only PayBox's read-only list_credentials tool and returns wallet metadata allowlisted above. */
export async function listPayBoxWallets(
  accessToken = process.env.PAYBOX_ACCESS_TOKEN
): Promise<PayBoxWalletListResult> {
  if (!accessToken?.trim()) {
    return {
      connection: "not-configured",
      endpoint: "https://api.paybox.sh/mcp",
      wallets: [],
      executionEnabled: false,
      detail: "Direct PayBox MCP is not configured. No network request was made."
    };
  }

  const client = new Client({ name: "veltrion-paybox-wallet-read", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://api.paybox.sh/mcp"),
    {
      requestInit: {
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    }
  );

  try {
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    const raw = await client.callTool({ name: "list_credentials", arguments: {} });
    const payload = parseMcpToolResult(raw);
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { credentials?: unknown }).credentials)) {
      return {
        connection: "error",
        endpoint: "https://api.paybox.sh/mcp",
        wallets: [],
        executionEnabled: false,
        detail: "PayBox credential response was unexpected or the read-only tool failed. No wallet metadata was returned."
      };
    }
    return {
      connection: "read",
      endpoint: "https://api.paybox.sh/mcp",
      wallets: summarizePayBoxWallets(payload),
      executionEnabled: false,
      detail: "Read-only wallet credential metadata retrieved. Cards, secrets, ungranted credentials, and raw provider payloads were excluded."
    };
  } catch {
    return {
      connection: "error",
      endpoint: "https://api.paybox.sh/mcp",
      wallets: [],
      executionEnabled: false,
      detail: "PayBox MCP wallet metadata could not be read. Authentication or grants may need setup; provider error details were suppressed."
    };
  } finally {
    try {
      await client.close();
    } catch {
      // Best-effort cleanup.
    }
  }
}
