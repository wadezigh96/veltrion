const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEXSCREENER_TOKEN_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_SIGNATURES = 25;
const MAX_TOKEN_ACCOUNTS = 100;
const MAX_PRICE_MINTS = 20;
const MAX_TX_CONCURRENCY = 4;

type JsonRecord = Record<string, unknown>;
type RpcEnvelope = { result?: unknown; error?: unknown };

function isRecord(value: unknown): value is JsonRecord {
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
  if (envelope.error) {
    const code = isRecord(envelope.error) && typeof envelope.error.code === "number" ? envelope.error.code : null;
    throw new Error(code === null ? "SOLANA_RPC_REQUEST_ERROR" : "SOLANA_RPC_REQUEST_ERROR_" + code);
  }
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
    if (!isRecord(data) || (data.program !== "spl-token" && data.program !== "spl-token-2022") ||
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
    if (!isRecord(item) || typeof item.signature !== "string" || item.signature.length < 64 || item.signature.length > 100 ||
        !Number.isSafeInteger(item.slot) || typeof item.slot !== "number" ||
        !(item.blockTime === null || item.blockTime === undefined ||
          (typeof item.blockTime === "number" && Number.isSafeInteger(item.blockTime))) ||
        !(item.err === null || item.err === undefined || isRecord(item.err) || Array.isArray(item.err))) {
      throw new Error("SOLANA_RPC_INVALID_SIGNATURE");
    }
    return {
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime ?? null,
      status: item.err === null || item.err === undefined ? "confirmed-success" : "failed",
      explorerUrl: `https://explorer.solana.com/tx/${encodeURIComponent(item.signature)}`
    };
  });
}

type PriceQuote = { priceUsd: number; liquidityUsd: number; pairAddress: string; dexId: string; source: string };

async function getTokenPrice(mint: string): Promise<PriceQuote | null> {
  const response = await fetch(`${DEXSCREENER_TOKEN_URL}${encodeURIComponent(mint)}`, {
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(6_000)
  });
  if (!response.ok) return null;
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) return null;
  const candidates = raw.filter((pair): pair is JsonRecord => isRecord(pair) &&
    isRecord(pair.baseToken) && pair.baseToken.address === mint &&
    typeof pair.priceUsd === "string" && Number.isFinite(Number(pair.priceUsd)) &&
    Number(pair.priceUsd) > 0 && isRecord(pair.liquidity) &&
    typeof pair.liquidity.usd === "number" && Number.isFinite(pair.liquidity.usd) && pair.liquidity.usd >= 1_000);
  candidates.sort((a, b) => Number((b.liquidity as JsonRecord).usd) - Number((a.liquidity as JsonRecord).usd));
  const best = candidates[0];
  if (!best || !isRecord(best.liquidity)) return null;
  return {
    priceUsd: Number(best.priceUsd),
    liquidityUsd: Number(best.liquidity.usd),
    pairAddress: typeof best.pairAddress === "string" ? best.pairAddress : "",
    dexId: typeof best.dexId === "string" ? best.dexId : "unknown",
    source: "DexScreener"
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

function collectTokenDeltas(meta: JsonRecord, address: string): Array<{ mint: string; deltaAtomic: string; decimals: number }> {
  const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
  const post = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
  const byMint = new Map<string, { pre: bigint; post: bigint; decimals: number }>();
  for (const [rows, key] of [[pre, "pre"], [post, "post"]] as const) {
    for (const row of rows) {
      if (!isRecord(row) || row.owner !== address || typeof row.mint !== "string" ||
          !isRecord(row.uiTokenAmount) || typeof row.uiTokenAmount.amount !== "string" ||
          !/^\d{1,40}$/.test(row.uiTokenAmount.amount) || typeof row.uiTokenAmount.decimals !== "number" ||
          !Number.isInteger(row.uiTokenAmount.decimals) || row.uiTokenAmount.decimals < 0 || row.uiTokenAmount.decimals > 18) continue;
      const current = byMint.get(row.mint) ?? { pre: 0n, post: 0n, decimals: row.uiTokenAmount.decimals };
      current[key] += BigInt(row.uiTokenAmount.amount);
      current.decimals = row.uiTokenAmount.decimals;
      byMint.set(row.mint, current);
    }
  }
  return [...byMint.entries()].map(([mint, amounts]) => ({
    mint,
    deltaAtomic: (amounts.post - amounts.pre).toString(),
    decimals: amounts.decimals
  })).filter(item => item.deltaAtomic !== "0");
}

const DEX_PROGRAM_HINTS = [
  "JUP6", "675kPX", "whirLb", "CAMMCzo", "LBUZKh", "Meteora",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
];
const STAKE_PROGRAM_HINTS = [
  "Stake11111111111111111111111111111111111111",
  "Marinade", "Jito"
];

function collectProgramIds(message: JsonRecord, meta: JsonRecord): string[] {
  const accountKeys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const ids = new Set<string>();
  for (const key of accountKeys) {
    if (typeof key === "string") ids.add(key);
    else if (isRecord(key) && typeof key.pubkey === "string") ids.add(key.pubkey);
  }
  const addInstructions = (instructions: unknown) => {
    if (!Array.isArray(instructions)) return;
    for (const instruction of instructions) {
      if (!isRecord(instruction)) continue;
      if (typeof instruction.programId === "string") ids.add(instruction.programId);
      if (typeof instruction.program === "string") ids.add(instruction.program);
      if (typeof instruction.programIdIndex === "number" && Number.isInteger(instruction.programIdIndex)) {
        const key = accountKeys[instruction.programIdIndex];
        if (typeof key === "string") ids.add(key);
        else if (isRecord(key) && typeof key.pubkey === "string") ids.add(key.pubkey);
      }
    }
  };
  addInstructions(message.instructions);
  if (Array.isArray(meta.innerInstructions)) {
    for (const group of meta.innerInstructions) {
      if (isRecord(group)) addInstructions(group.instructions);
    }
  }
  return [...ids];
}

async function enrichSignature(signature: ReturnType<typeof parseSignatures>[number], address: string) {
  try {
    const raw = await rpc("getTransaction", [signature.signature, {
      encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0
    }]);
    if (!isRecord(raw)) return { ...signature, category: "unclassified", tokenDeltas: [], detailsAvailable: false };
    const meta = isRecord(raw.meta) ? raw.meta : {};
    const transaction = isRecord(raw.transaction) ? raw.transaction : {};
    const message = isRecord(transaction.message) ? transaction.message : {};
    const programs = collectProgramIds(message, meta);
    const tokenDeltas = collectTokenDeltas(meta, address);
    const logs = Array.isArray(meta.logMessages) ? meta.logMessages.filter((v): v is string => typeof v === "string").join(" ") : "";
    const haystack = programs.join(" ") + " " + logs;
    let category = "other";
    let classificationConfidence = "low";
    if (meta.err !== null && meta.err !== undefined) {
      category = "failed";
      classificationConfidence = "high";
    } else if (tokenDeltas.length >= 2 && (DEX_PROGRAM_HINTS.some(hint => haystack.toLowerCase().includes(hint.toLowerCase())) || /instruction:\s*swap/i.test(haystack))) {
      category = "swap";
      classificationConfidence = "medium";
    } else if (STAKE_PROGRAM_HINTS.some(hint => haystack.includes(hint))) {
      category = "staking-or-unstaking";
      classificationConfidence = "low";
    } else if (tokenDeltas.length > 0) {
      category = "token-movement";
      classificationConfidence = "low";
    } else if (programs.includes(SPL_TOKEN_PROGRAM) || programs.includes(TOKEN_2022_PROGRAM) ||
      programs.includes("spl-token") || programs.includes("spl-token-2022")) {
      category = "token-program-interaction";
      classificationConfidence = "low";
    }
    let solDelta: string | null = null;
    if (Array.isArray(message.accountKeys) && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
      const walletIndex = message.accountKeys.findIndex(key => isRecord(key) ? key.pubkey === address : key === address);
      const before = meta.preBalances[walletIndex];
      const after = meta.postBalances[walletIndex];
      if (walletIndex >= 0 && typeof before === "number" && Number.isSafeInteger(before) &&
          typeof after === "number" && Number.isSafeInteger(after)) {
        solDelta = formatAtomic(BigInt(after) - BigInt(before), 9);
      }
    }
    return {
      ...signature,
      category,
      classificationConfidence,
      tokenDeltas,
      solDelta,
      feeLamports: typeof meta.fee === "number" && Number.isSafeInteger(meta.fee) ? String(meta.fee) : null,
      detailsAvailable: true
    };
  } catch {
    return { ...signature, category: "details-unavailable", tokenDeltas: [], detailsAvailable: false };
  }
}

export type SolanaWalletPortfolio = {
  address: string;
  network: "solana-mainnet";
  nativeBalance: { lamports: string; sol: string };
  tokenAccounts: Array<{
    tokenAccount: string; mint: string; amountAtomic: string; decimals: number; amount: string;
    tokenProgram: "spl-token" | "token-2022"; accountLamports: number;
    priceUsd: number | null; valueUsd: number | null; priceSource: string | null;
  }>;
  recentActivity: Array<ReturnType<typeof parseSignatures>[number] & {
    category: string; classificationConfidence?: string;
    tokenDeltas: Array<{ mint: string; deltaAtomic: string; decimals: number }>;
    solDelta?: string | null; feeLamports?: string | null; detailsAvailable: boolean;
  }>;
  valuation: { totalUsd: number | null; pricedTokenAccounts: number; unpricedTokenAccounts: number; source: "DexScreener"; note: string };
  activityNote: string;
  fetchedAt: string;
  source: { rpc: string; pricing: string };
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
    rpc("getSignaturesForAddress", [address, { limit: requestedLimit, commitment: "confirmed" }])
  ]);

  const tokenAccounts = [
    ...parseTokenAccounts(splRaw, "spl-token"),
    ...parseTokenAccounts(token2022Raw, "token-2022")
  ];
  if (tokenAccounts.length > MAX_TOKEN_ACCOUNTS) throw new Error("SOLANA_TOKEN_ACCOUNT_LIMIT_EXCEEDED");
  const signatures = parseSignatures(signaturesRaw);
  const mints = [...new Set([WRAPPED_SOL_MINT, ...tokenAccounts.map(token => token.mint)])].slice(0, MAX_PRICE_MINTS);
  const prices = new Map<string, PriceQuote | null>();
  await mapWithConcurrency(mints, 4, async mint => {
    try { prices.set(mint, await getTokenPrice(mint)); } catch { prices.set(mint, null); }
    return null;
  });
  const valuedTokens = tokenAccounts.map(token => {
    const quote = prices.get(token.mint) ?? null;
    const amount = Number(token.amount);
    const valueUsd = quote && Number.isFinite(amount) ? amount * quote.priceUsd : null;
    return {
      ...token, priceUsd: quote?.priceUsd ?? null, valueUsd: valueUsd !== null && Number.isFinite(valueUsd) ? valueUsd : null,
      priceSource: quote ? quote.source : null
    };
  });
  const nativeBalance = parseNativeBalance(balanceRaw);
  const solQuote = prices.get(WRAPPED_SOL_MINT) ?? null;
  const nativeValue = solQuote ? Number(nativeBalance.sol) * solQuote.priceUsd : null;
  const knownTokenValues = valuedTokens.filter(token => token.valueUsd !== null).map(token => token.valueUsd as number);
  const totalUsd = solQuote && nativeValue !== null && Number.isFinite(nativeValue) &&
    valuedTokens.every(token => token.valueUsd !== null)
    ? knownTokenValues.reduce((sum, value) => sum + value, nativeValue)
    : null;
  const recentActivity = await mapWithConcurrency(signatures, MAX_TX_CONCURRENCY, signature => enrichSignature(signature, address));

  return {
    address,
    network: "solana-mainnet",
    nativeBalance,
    tokenAccounts: valuedTokens,
    recentActivity,
    valuation: {
      totalUsd: totalUsd !== null && Number.isFinite(totalUsd) ? totalUsd : null,
      pricedTokenAccounts: valuedTokens.filter(token => token.valueUsd !== null).length,
      unpricedTokenAccounts: valuedTokens.filter(token => token.valueUsd === null).length,
      source: "DexScreener",
      note: totalUsd === null
        ? "Total USD is omitted because one or more token accounts or native SOL could not be priced from a qualifying liquidity pair. Token prices are estimates, not executable quotes."
        : "Estimated spot value using the highest-liquidity DexScreener pair per mint; excludes protocol positions, LP valuation, pending rewards, and future fees."
    },
    activityNote: "Transaction details are fetched live from Solana RPC. Categories are heuristics, not authoritative protocol decoding. Token deltas include only token balances whose RPC owner field matches this address; internal program movements may be omitted.",
    fetchedAt: new Date().toISOString(),
    source: { rpc: SOLANA_RPC_URL, pricing: "DexScreener API" },
    executionEnabled: false
  };
}
