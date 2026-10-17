const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_SIGNATURES = 25;
const MAX_TOKEN_ACCOUNTS = 100;

type RpcEnvelope = { result?: unknown; error?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatAtomic(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: `veltrion-${method}`, method, params })
  });
  if (!response.ok) throw new Error("SOLANA_RPC_HTTP_ERROR");
  const raw: unknown = await response.json();
  if (!isRecord(raw)) throw new Error("SOLANA_RPC_INVALID_RESPONSE");
  const envelope = raw as RpcEnvelope;
  if (envelope.error) throw new Error("SOLANA_RPC_REQUEST_ERROR");
  if (!("result" in envelope)) throw new Error("SOLANA_RPC_INVALID_RESPONSE");
  return envelope.result;
}

function parseNativeBalance(value: unknown): { lamports: string; sol: string } {
  if (!isRecord(value) || typeof value.value !== "number" ||
      !Number.isSafeInteger(value.value) || value.value < 0) {
    throw new Error("SOLANA_RPC_INVALID_BALANCE");
  }
  const lamports = BigInt(value.value);
  return { lamports: lamports.toString(), sol: formatAtomic(lamports, 9) };
}

function parseTokenAccounts(value: unknown, program: "spl-token" | "token-2022") {
  if (!isRecord(value) || !Array.isArray(value.value)) throw new Error("SOLANA_RPC_INVALID_TOKEN_ACCOUNTS");
  if (value.value.length > MAX_TOKEN_ACCOUNTS) throw new Error("SOLANA_TOKEN_ACCOUNT_LIMIT_EXCEEDED");
  return value.value.map(item => {
    if (!isRecord(item) || typeof item.pubkey !== "string" || !isRecord(item.account)) {
      throw new Error("SOLANA_RPC_INVALID_TOKEN_ACCOUNT");
    }
    const data = item.account.data;
    if (!isRecord(data) || data.program !== "spl-token" && data.program !== "spl-token-2022" ||
        !isRecord(data.parsed) || !isRecord(data.parsed.info)) {
      throw new Error("SOLANA_RPC_INVALID_TOKEN_DATA");
    }
    const info = data.parsed.info;
    const tokenAmount = info.tokenAmount;
    if (typeof info.mint !== "string" || !BASE58_ADDRESS.test(info.mint) || !isRecord(tokenAmount) ||
        typeof tokenAmount.amount !== "string" || !/^\d{1,40}$/.test(tokenAmount.amount) ||
        typeof tokenAmount.decimals !== "number" || !Number.isInteger(tokenAmount.decimals) ||
        tokenAmount.decimals < 0 || tokenAmount.decimals > 18 ||
        typeof tokenAmount.uiAmountString !== "string" || tokenAmount.uiAmountString.length > 100) {
      throw new Error("SOLANA_RPC_INVALID_TOKEN_AMOUNT");
    }
    if (typeof item.account.lamports !== "number" || !Number.isSafeInteger(item.account.lamports) || item.account.lamports < 0) {
      throw new Error("SOLANA_RPC_INVALID_TOKEN_ACCOUNT");
    }
    return {
      tokenAccount: item.pubkey,
      mint: info.mint,
      amountAtomic: tokenAmount.amount,
      decimals: tokenAmount.decimals,
      amount: tokenAmount.uiAmountString,
      tokenProgram: program,
      accountLamports: item.account.lamports
    };
  });
}

function parseSignatures(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_SIGNATURES) throw new Error("SOLANA_RPC_INVALID_SIGNATURES");
  return value.map(item => {
    if (!isRecord(item) || typeof item.signature !== "string" ||
        !Number.isSafeInteger(item.slot) || typeof item.slot !== "number" ||
        !(item.blockTime === null || item.blockTime === undefined ||
          (typeof item.blockTime === "number" && Number.isSafeInteger(item.blockTime))) ||
        !(item.err === null || isRecord(item.err) || Array.isArray(item.err))) {
      throw new Error("SOLANA_RPC_INVALID_SIGNATURE");
    }
    return {
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime ?? null,
      status: item.err === null ? "confirmed-success" : "failed",
      explorerUrl: `https://explorer.solana.com/tx/${encodeURIComponent(item.signature)}`
    };
  });
}

export type SolanaWalletPortfolio = {
  address: string;
  network: "solana-mainnet";
  nativeBalance: { lamports: string; sol: string };
  tokenAccounts: ReturnType<typeof parseTokenAccounts>[number][];
  recentActivity: ReturnType<typeof parseSignatures>;
  activityNote: string;
  tokenValuations: "not-included-no-trusted-price-source";
  fetchedAt: string;
  source: string;
  executionEnabled: false;
};

export async function getSolanaWalletPortfolio(address: string, requestedLimit = 10): Promise<SolanaWalletPortfolio> {
  if (!BASE58_ADDRESS.test(address)) throw new Error("INVALID_WALLET_ADDRESS");
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_SIGNATURES) {
    throw new Error("INVALID_ACTIVITY_LIMIT");
  }

  const [balanceRaw, splRaw, token2022Raw, signaturesRaw] = await Promise.all([
    rpc("getBalance", [address, { commitment: "confirmed" }]),
    rpc("getTokenAccountsByOwner", [address, { programId: SPL_TOKEN_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" }]),
    rpc("getTokenAccountsByOwner", [address, { programId: TOKEN_2022_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" }]),
    rpc("getSignaturesForAddress", [address, { limit: requestedLimit }, { commitment: "confirmed" }])
  ]);

  const tokenAccounts = [
    ...parseTokenAccounts(splRaw, "spl-token"),
    ...parseTokenAccounts(token2022Raw, "token-2022")
  ];
  if (tokenAccounts.length > MAX_TOKEN_ACCOUNTS) throw new Error("SOLANA_TOKEN_ACCOUNT_LIMIT_EXCEEDED");

  return {
    address,
    network: "solana-mainnet",
    nativeBalance: parseNativeBalance(balanceRaw),
    tokenAccounts,
    recentActivity: parseSignatures(signaturesRaw),
    activityNote: "Activity contains recent signatures involving this address. Transaction categories and token USD values are not inferred; a signature may represent a transaction with multiple effects.",
    tokenValuations: "not-included-no-trusted-price-source",
    fetchedAt: new Date().toISOString(),
    source: SOLANA_RPC_URL,
    executionEnabled: false
  };
}
