const YIELDS_URL = "https://yields.llama.fi/pools";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_POOLS_TO_RETURN = 100;
const MAX_APY_FOR_RANKING = 100;
const MAX_RESPONSE_BYTES = 20_000_000;

type RecordValue = Record<string, unknown>;

export type DefiOpportunity = {
  pool: string;
  project: string;
  chain: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  stablecoin: boolean | null;
  ilRisk: string | null;
  exposure: string | null;
  rewardTokens: string[];
  riskFlags: string[];
};

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeText(value: unknown, max = 120): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Strictly normalizes untrusted public yield API data; APY values are estimates, never guarantees. */
export function normalizeYieldPools(
  raw: unknown,
  options: { chain?: string; minTvlUsd?: number; limit?: number; maxApyForRanking?: number } = {}
): DefiOpportunity[] {
  if (!isRecord(raw) || !Array.isArray(raw.data)) throw new Error("YIELDS_INVALID_RESPONSE");
  const chain = (options.chain ?? "Solana").toLowerCase();
  const minTvlUsd = options.minTvlUsd ?? 10_000;
  const limit = options.limit ?? 20;
  const maxApyForRanking = options.maxApyForRanking ?? MAX_APY_FOR_RANKING;
  if (!Number.isFinite(minTvlUsd) || minTvlUsd < 0 || minTvlUsd > 1_000_000_000) throw new Error("INVALID_MIN_TVL");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POOLS_TO_RETURN) throw new Error("INVALID_POOL_LIMIT");
  if (!Number.isFinite(maxApyForRanking) || maxApyForRanking <= 0 || maxApyForRanking > 10_000) throw new Error("INVALID_APY_LIMIT");

  const candidates: DefiOpportunity[] = [];
  for (const row of raw.data) {
    if (!isRecord(row)) continue;
    const rowChain = safeText(row.chain, 80);
    const project = safeText(row.project, 100);
    const symbol = safeText(row.symbol, 100);
    const pool = safeText(row.pool, 160);
    const tvlUsd = finiteNonNegative(row.tvlUsd);
    if (!rowChain || rowChain.toLowerCase() !== chain || !project || !symbol || !pool ||
        tvlUsd === null || tvlUsd < minTvlUsd) continue;

    const apy = typeof row.apy === "number" && Number.isFinite(row.apy) ? row.apy : null;
    const apyBase = typeof row.apyBase === "number" && Number.isFinite(row.apyBase) ? row.apyBase : null;
    const apyReward = typeof row.apyReward === "number" && Number.isFinite(row.apyReward) ? row.apyReward : null;
    const riskFlags: string[] = [];
    if (apy === null || apy < 0) riskFlags.push("APY_MISSING_OR_INVALID");
    else if (apy > maxApyForRanking) riskFlags.push("APY_OUTLIER_VERIFY_BEFORE_USE");
    if (tvlUsd < 50_000) riskFlags.push("LOWER_TVL");
    if (row.ilRisk === "yes") riskFlags.push("IMPERMANENT_LOSS_RISK");
    if (row.stablecoin === false) riskFlags.push("NOT_STABLECOIN_ONLY");
    if (apyReward !== null && apyReward > 0) riskFlags.push("REWARD_APY_MAY_VARY");
    const rewardTokens = Array.isArray(row.rewardTokens)
      ? row.rewardTokens.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 10).map(item => item.slice(0, 100))
      : [];
    candidates.push({
      pool, project, chain: rowChain, symbol, tvlUsd, apy, apyBase, apyReward,
      stablecoin: typeof row.stablecoin === "boolean" ? row.stablecoin : null,
      ilRisk: safeText(row.ilRisk, 30),
      exposure: safeText(row.exposure, 30),
      rewardTokens,
      riskFlags
    });
  }

  candidates.sort((a, b) => {
    const aRankable = a.apy !== null && a.apy >= 0 && a.apy <= maxApyForRanking;
    const bRankable = b.apy !== null && b.apy >= 0 && b.apy <= maxApyForRanking;
    if (aRankable !== bRankable) return aRankable ? -1 : 1;
    if (aRankable && bRankable && a.apy !== b.apy) return (b.apy ?? 0) - (a.apy ?? 0);
    return b.tvlUsd - a.tvlUsd;
  });
  return candidates.slice(0, limit);
}

export async function scanDefiOpportunities(options: {
  chain?: string;
  minTvlUsd?: number;
  limit?: number;
} = {}): Promise<{
  source: string;
  fetchedAt: string;
  chain: string;
  filters: { minTvlUsd: number; limit: number };
  opportunities: DefiOpportunity[];
  disclaimer: string;
  executionEnabled: false;
}> {
  const chain = options.chain ?? "Solana";
  if (chain.toLowerCase() !== "solana") throw new Error("UNSUPPORTED_CHAIN");
  const minTvlUsd = options.minTvlUsd ?? 10_000;
  const limit = options.limit ?? 20;
  if (!Number.isFinite(minTvlUsd) || minTvlUsd < 0 || minTvlUsd > 1_000_000_000) throw new Error("INVALID_MIN_TVL");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POOLS_TO_RETURN) throw new Error("INVALID_POOL_LIMIT");

  const response = await fetch(YIELDS_URL, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error("YIELDS_PROVIDER_UNAVAILABLE");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("YIELDS_RESPONSE_TOO_LARGE");
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; } catch { throw new Error("YIELDS_INVALID_RESPONSE"); }
  return {
    source: "DefiLlama Yields API",
    fetchedAt: new Date().toISOString(),
    chain,
    filters: { minTvlUsd, limit },
    opportunities: normalizeYieldPools(raw, { chain, minTvlUsd, limit }),
    disclaimer: "Public yield/TVL data is a snapshot, may be delayed or incomplete, and is not a guarantee. APY can change or be an outlier; verify protocol, pool contract, token, fees, withdrawal conditions, smart-contract risk, and impermanent loss before depositing. This scan does not identify the caller's deposited positions or claimable rewards.",
    executionEnabled: false
  };
}
