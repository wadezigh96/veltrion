const RPC_URL = "https://api.mainnet-beta.solana.com";
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

type Obj = Record<string, unknown>;
function isObj(v: unknown): v is Obj { return v !== null && typeof v === "object" && !Array.isArray(v); }

export async function getSolanaTransactionStatus(signature: string): Promise<{
  signature: string;
  network: "solana-mainnet";
  status: string;
  confirmationStatus: string | null;
  slot: number | null;
  confirmations: number | null;
  transactionError: unknown | null;
  transactionAvailable: boolean;
  explorerUrl: string;
  fetchedAt: string;
  source: string;
  executionEnabled: false;
}> {
  if (!BASE58_SIGNATURE.test(signature)) throw new Error("INVALID_TRANSACTION_SIGNATURE");
  const response = await fetch(RPC_URL, {
    method: "POST", redirect: "error",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      jsonrpc: "2.0", id: "veltrion-transaction-status",
      method: "getSignatureStatuses",
      params: [[signature], { searchTransactionHistory: true }]
    })
  });
  if (!response.ok) throw new Error("SOLANA_RPC_HTTP_ERROR");
  const raw: unknown = await response.json();
  if (!isObj(raw) || raw.error || !isObj(raw.result) || !Array.isArray(raw.result.value)) {
    throw new Error("SOLANA_RPC_INVALID_RESPONSE");
  }
  const status = raw.result.value[0];
  let statusLabel = "not-found-or-not-indexed";
  let confirmationStatus: string | null = null;
  let slot: number | null = null;
  let confirmations: number | null = null;
  let transactionError: unknown | null = null;
  if (isObj(status)) {
    confirmationStatus = typeof status.confirmationStatus === "string" ? status.confirmationStatus : null;
    slot = typeof status.slot === "number" && Number.isSafeInteger(status.slot) ? status.slot : null;
    confirmations = typeof status.confirmations === "number" && Number.isSafeInteger(status.confirmations) ? status.confirmations : null;
    transactionError = status.err ?? null;
    if (transactionError !== null) statusLabel = "failed";
    else if (confirmationStatus === "finalized") statusLabel = "finalized-success";
    else if (confirmationStatus === "confirmed") statusLabel = "confirmed-success";
    else if (confirmationStatus === "processed") statusLabel = "processed-not-final";
    else statusLabel = "observed-status-unknown";
  }
  return {
    signature, network: "solana-mainnet", status: statusLabel, confirmationStatus, slot, confirmations,
    transactionError, transactionAvailable: status !== null && status !== undefined,
    explorerUrl: `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`,
    fetchedAt: new Date().toISOString(), source: RPC_URL, executionEnabled: false
  };
}
