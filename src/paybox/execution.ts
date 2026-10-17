import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { listPayBoxWallets } from "./mcp.js";

const ENDPOINT = "https://api.paybox.sh/mcp";
const ALLOWED_CHAIN = "solana:mainnet";
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POSITIVE_ATOMIC = /^[1-9]\d{0,39}$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.VELTRION_PAYBOX_EXECUTION_ENABLED === "true";
  const token = env.PAYBOX_ACCESS_TOKEN?.trim() ?? "";
  return { enabled, token, configured: enabled && token.length > 0 };
}

export function getPayBoxExecutionStatus(env: NodeJS.ProcessEnv = process.env) {
  const config = readConfig(env);
  return {
    provider: "PayBox MCP",
    endpoint: ENDPOINT,
    configured: config.configured,
    executionEnabled: config.configured,
    chainScope: [ALLOWED_CHAIN],
    detail: !config.enabled
      ? "Money-moving PayBox tools are disabled. Set VELTRION_PAYBOX_EXECUTION_ENABLED=true only after reviewing the deployment and authorization policy."
      : !config.token
        ? "Execution flag is enabled but PAYBOX_ACCESS_TOKEN is absent. Use PayBox's supported OAuth flow; no request was sent."
        : "Execution is enabled for explicitly called Solana tools. PayBox remains the wallet authorization/signing boundary; no request is made by this status check."
  };
}

function parseToolPayload(value: unknown): unknown {
  if (!isObj(value) || value.isError === true) return null;
  if (isObj(value.structuredContent)) return value.structuredContent;
  if (!Array.isArray(value.content)) return null;
  const textItem = value.content.find(item => isObj(item) && item.type === "text" && typeof item.text === "string");
  if (!isObj(textItem) || typeof textItem.text !== "string") return null;
  try { return JSON.parse(textItem.text) as unknown; } catch { return { message: textItem.text.slice(0, 500) }; }
}

/** Return only known-safe operation fields; never echo provider raw payloads or credentials. */
function sanitizeOperation(value: unknown, operation: string) {
  const payload = parseToolPayload(value);
  if (!isObj(payload)) {
    return { operation, status: "unknown", error: "PAYBOX_INVALID_RESPONSE", retryPolicy: "Do not submit a duplicate request; inspect PayBox request history." };
  }
  const output: Record<string, unknown> = { operation, provider: "PayBox MCP", executionEnabled: true };
  for (const key of ["request_id", "status", "state", "transaction_hash", "tx_hash", "chain", "to", "token", "amount", "error", "error_code", "retryable", "detail"]) {
    const item = payload[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) {
      if (typeof item !== "string" || item.length <= 500) output[key] = item;
    }
  }
  const approval = payload.approval_url;
  if (typeof approval === "string") {
    try {
      const url = new URL(approval);
      if (url.protocol === "https:" && (url.hostname === "paybox.sh" || url.hostname.endsWith(".paybox.sh"))) {
        output.approval_url = url.toString();
      }
    } catch { /* invalid approval URLs are intentionally omitted */ }
  }
  output.retryPolicy = "Never re-submit this money operation to recover from pending or unknown status. Poll the same request_id with paybox_request_status.";
  return output;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const config = readConfig();
  if (!config.token) throw new Error("PAYBOX_ACCESS_TOKEN_MISSING");
  const client = new Client({ name: "veltrion-paybox-execution", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.token}` }
    }
  });
  try {
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    return await fn(client);
  } catch (error) {
    if (error instanceof Error && /^PAYBOX_[A-Z0-9_]+$/.test(error.message)) throw error;
    throw new Error("PAYBOX_MCP_REQUEST_FAILED");
  } finally {
    try { await client.close(); } catch { /* best-effort cleanup */ }
  }
}

async function assertGrantedSolanaWallet(credentialId: string): Promise<void> {
  const wallets = await listPayBoxWallets();
  if (wallets.connection !== "read") throw new Error("PAYBOX_WALLET_GRANTS_UNAVAILABLE");
  const wallet = wallets.wallets.find(item => item.credentialId === credentialId);
  if (!wallet) throw new Error("PAYBOX_WALLET_NOT_GRANTED");
  if (!wallet.chains.some(chain => /solana/i.test(chain))) throw new Error("PAYBOX_WALLET_CHAIN_UNSUPPORTED");
}

/** Requests a swap through PayBox only after the server-side feature gate and wallet grant checks pass. */
export async function requestPayBoxSolanaSwap(input: {
  credentialId: string;
  srcToken: string;
  dstToken: string;
  amount: string;
  slippageBps: number;
  confirmed: boolean;
}) {
  const config = readConfig();
  if (!config.configured) throw new Error(config.enabled ? "PAYBOX_ACCESS_TOKEN_MISSING" : "PAYBOX_EXECUTION_DISABLED");
  if (input.confirmed !== true) throw new Error("EXPLICIT_CONFIRMATION_REQUIRED");
  if (!input.credentialId.trim() || input.credentialId.length > 200) throw new Error("INVALID_CREDENTIAL_ID");
  if (!POSITIVE_ATOMIC.test(input.amount)) throw new Error("INVALID_ATOMIC_AMOUNT");
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 300) throw new Error("INVALID_SLIPPAGE");
  if (input.srcToken !== "native" && !BASE58_ADDRESS.test(input.srcToken)) throw new Error("INVALID_SOURCE_TOKEN");
  if (input.dstToken !== "native" && !BASE58_ADDRESS.test(input.dstToken)) throw new Error("INVALID_DESTINATION_TOKEN");
  await assertGrantedSolanaWallet(input.credentialId);
  return await withClient(async client => sanitizeOperation(await client.callTool({
    name: "request_swap",
    arguments: {
      credential_id: input.credentialId,
      src_chain: ALLOWED_CHAIN,
      dst_chain: ALLOWED_CHAIN,
      src_token: input.srcToken,
      dst_token: input.dstToken,
      amount: input.amount,
      slippage_bps: input.slippageBps,
      swap_direction: "exact-amount-in"
    }
  }), "swap"));
}

/** Requests a transfer through PayBox only after the server-side feature gate and wallet grant checks pass. */
export async function requestPayBoxSolanaTransfer(input: {
  credentialId: string;
  to: string;
  token?: string | undefined;
  amount: string;
  confirmed: boolean;
}) {
  const config = readConfig();
  if (!config.configured) throw new Error(config.enabled ? "PAYBOX_ACCESS_TOKEN_MISSING" : "PAYBOX_EXECUTION_DISABLED");
  if (input.confirmed !== true) throw new Error("EXPLICIT_CONFIRMATION_REQUIRED");
  if (!input.credentialId.trim() || input.credentialId.length > 200) throw new Error("INVALID_CREDENTIAL_ID");
  if (!BASE58_ADDRESS.test(input.to)) throw new Error("INVALID_RECIPIENT");
  if (!POSITIVE_ATOMIC.test(input.amount)) throw new Error("INVALID_ATOMIC_AMOUNT");
  if (input.token !== undefined && input.token !== "native" && !BASE58_ADDRESS.test(input.token)) throw new Error("INVALID_TOKEN");
  await assertGrantedSolanaWallet(input.credentialId);
  return await withClient(async client => sanitizeOperation(await client.callTool({
    name: "request_transfer",
    arguments: {
      credential_id: input.credentialId,
      chain: ALLOWED_CHAIN,
      to: input.to,
      amount: input.amount,
      ...(input.token === undefined || input.token === "native" ? {} : { token: input.token })
    }
  }), "transfer"));
}

/** Reconciles the same PayBox request; never re-issues the underlying operation. */
export async function getPayBoxRequestStatus(requestId: string) {
  if (!requestId.trim() || requestId.length > 200) throw new Error("INVALID_REQUEST_ID");
  return await withClient(async client => sanitizeOperation(await client.callTool({
    name: "get_request",
    arguments: { request_id: requestId }
  }), "request-status"));
}
