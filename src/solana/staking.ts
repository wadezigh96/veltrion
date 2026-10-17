const RPC_URL = "https://api.mainnet-beta.solana.com";
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_STAKE_ACCOUNTS = 50;
const MAX_RESPONSE_CHARS = 5_000_000;

type Obj = Record<string, unknown>;
function isObj(v: unknown): v is Obj { return v !== null && typeof v === "object" && !Array.isArray(v); }

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: "POST", redirect: "error",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: "veltrion-stake-monitor", method, params })
  });
  if (!response.ok) throw new Error("SOLANA_RPC_HTTP_ERROR");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error("SOLANA_RPC_RESPONSE_TOO_LARGE");
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; } catch { throw new Error("SOLANA_RPC_INVALID_RESPONSE"); }
  if (!isObj(raw)) throw new Error("SOLANA_RPC_INVALID_RESPONSE");
  if (raw.error) throw new Error("SOLANA_RPC_REQUEST_ERROR");
  if (!("result" in raw)) throw new Error("SOLANA_RPC_INVALID_RESPONSE");
  return raw.result;
}

function parsedStakeRows(raw: unknown): Array<{ pubkey: string; lamports: number; voter: string | null; delegatedStake: string | null }> {
  if (!Array.isArray(raw)) throw new Error("SOLANA_STAKE_INVALID_RESPONSE");
  if (raw.length > MAX_STAKE_ACCOUNTS) throw new Error("SOLANA_STAKE_ACCOUNT_LIMIT_EXCEEDED");
  return raw.map((row) => {
    if (!isObj(row) || typeof row.pubkey !== "string" || !isObj(row.account) ||
        typeof row.account.lamports !== "number" || !Number.isSafeInteger(row.account.lamports) || row.account.lamports < 0) {
      throw new Error("SOLANA_STAKE_INVALID_ACCOUNT");
    }
    const data = row.account.data;
    const parsed = isObj(data) && isObj(data.parsed) ? data.parsed : null;
    const info = parsed && isObj(parsed.info) ? parsed.info : null;
    const stake = info && isObj(info.stake) ? info.stake : null;
    const delegation = stake && isObj(stake.delegation) ? stake.delegation : null;
    return {
      pubkey: row.pubkey,
      lamports: row.account.lamports,
      voter: delegation && typeof delegation.voter === "string" ? delegation.voter : null,
      delegatedStake: delegation && (typeof delegation.stake === "string" || typeof delegation.stake === "number")
        ? String(delegation.stake) : null
    };
  });
}

/** Read-only native Solana stake account monitor. Does not cover liquid-staking tokens or third-party LP farms. */
export async function monitorNativeSolanaStake(address: string): Promise<{
  address: string;
  network: "solana-mainnet";
  source: string;
  fetchedAt: string;
  accounts: Array<{ stakeAccount: string; lamports: number; sol: string; voter: string | null; delegatedStakeLamports: string | null; activation: unknown | null; status: string }>;
  totalStakeAccountSol: string;
  limitations: string;
  executionEnabled: false;
}> {
  if (!BASE58_ADDRESS.test(address)) throw new Error("INVALID_WALLET_ADDRESS");
  const [stakerRaw, withdrawerRaw] = await Promise.all([
    rpc("getProgramAccounts", [STAKE_PROGRAM, { encoding: "jsonParsed", commitment: "confirmed", filters: [{ memcmp: { offset: 12, bytes: address } }] }]),
    rpc("getProgramAccounts", [STAKE_PROGRAM, { encoding: "jsonParsed", commitment: "confirmed", filters: [{ memcmp: { offset: 44, bytes: address } }] }])
  ]);
  const deduped = new Map<string, ReturnType<typeof parsedStakeRows>[number]>();
  for (const row of [...parsedStakeRows(stakerRaw), ...parsedStakeRows(withdrawerRaw)]) deduped.set(row.pubkey, row);
  if (deduped.size > MAX_STAKE_ACCOUNTS) throw new Error("SOLANA_STAKE_ACCOUNT_LIMIT_EXCEEDED");
  const rows = [...deduped.values()];
  const accounts = await Promise.all(rows.map(async row => {
    let activation: unknown | null = null;
    let status = row.delegatedStake === null ? "not-currently-delegated-or-parser-unavailable" : "delegated";
    try {
      const raw = await rpc("getStakeActivation", [row.pubkey, { commitment: "confirmed" }]);
      if (isObj(raw)) {
        activation = raw;
        if (typeof raw.state === "string") status = raw.state;
      }
    } catch { status = "activation-status-unavailable"; }
    return {
      stakeAccount: row.pubkey,
      lamports: row.lamports,
      sol: (row.lamports / 1_000_000_000).toFixed(9).replace(/0+$/, "").replace(/\.$/, ""),
      voter: row.voter,
      delegatedStakeLamports: row.delegatedStake,
      activation,
      status
    };
  }));
  const total = rows.reduce((sum, row) => sum + BigInt(row.lamports), 0n);
  const whole = total / 1_000_000_000n;
  const fraction = (total % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return {
    address, network: "solana-mainnet", source: RPC_URL, fetchedAt: new Date().toISOString(),
    accounts, totalStakeAccountSol: fraction ? `${whole}.${fraction}` : whole.toString(),
    limitations: "Only native Solana stake-program accounts where the supplied wallet is staker or withdrawer are included. Liquid-staking tokens, LP positions, third-party farming deposits, pending rewards, and protocol-specific claimable rewards are not decoded by this tool.",
    executionEnabled: false
  };
}
