const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_ACCOUNT_DATA_BYTES = 100_000;

export type SolanaMintInspection = {
  mint: string;
  tokenProgram: "spl-token" | "token-2022";
  decimals: number;
  supplyAtomic: string;
  initialized: boolean;
  mintAuthorityEnabled: boolean;
  freezeAuthorityEnabled: boolean;
  accountLamports: number;
  source: string;
  executionEnabled: false;
};

type RpcMintResponse = {
  result?: {
    value?: {
      owner?: unknown;
      lamports?: unknown;
      executable?: unknown;
      data?: unknown;
    } | null;
  };
  error?: unknown;
};

export function parseSolanaMintAccount(mint: string, value: unknown): SolanaMintInspection {
  if (!BASE58_ADDRESS.test(mint)) throw new Error("INVALID_MINT_FORMAT");
  if (!value || typeof value !== "object") throw new Error("INVALID_RPC_ACCOUNT");
  const account = value as { owner?: unknown; lamports?: unknown; executable?: unknown; data?: unknown };
  if (account.executable === true) throw new Error("MINT_ACCOUNT_IS_EXECUTABLE");
  if (account.owner !== SPL_TOKEN_PROGRAM && account.owner !== TOKEN_2022_PROGRAM) {
    throw new Error("UNSUPPORTED_MINT_OWNER");
  }
  if (typeof account.lamports !== "number" || !Number.isSafeInteger(account.lamports) || account.lamports < 0) {
    throw new Error("INVALID_ACCOUNT_LAMPORTS");
  }
  if (!Array.isArray(account.data) || typeof account.data[0] !== "string" || account.data[0].length > 140_000) {
    throw new Error("INVALID_ACCOUNT_DATA");
  }

  const bytes = Buffer.from(account.data[0], "base64");
  if (bytes.length < 82 || bytes.length > MAX_ACCOUNT_DATA_BYTES) throw new Error("INVALID_MINT_DATA_LENGTH");
  const supplyAtomic = bytes.readBigUInt64LE(36).toString();
  const decimals = bytes[44];
  const initializedByte = bytes[45];
  if (decimals === undefined || initializedByte === undefined || (initializedByte !== 0 && initializedByte !== 1)) {
    throw new Error("INVALID_MINT_LAYOUT");
  }

  return {
    mint,
    tokenProgram: account.owner === TOKEN_2022_PROGRAM ? "token-2022" : "spl-token",
    decimals,
    supplyAtomic,
    initialized: initializedByte === 1,
    mintAuthorityEnabled: bytes.readUInt32LE(0) === 1,
    freezeAuthorityEnabled: bytes.readUInt32LE(46) === 1,
    accountLamports: account.lamports,
    source: SOLANA_RPC_URL,
    executionEnabled: false
  };
}

export async function inspectSolanaMint(mint: string): Promise<SolanaMintInspection> {
  if (!BASE58_ADDRESS.test(mint)) throw new Error("INVALID_MINT_FORMAT");
  const response = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "veltrion-mint-inspect",
      method: "getAccountInfo",
      params: [mint, { encoding: "base64", commitment: "confirmed" }]
    })
  });
  if (!response.ok) throw new Error("SOLANA_RPC_HTTP_ERROR");
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") throw new Error("SOLANA_RPC_INVALID_RESPONSE");
  const rpc = raw as RpcMintResponse;
  if (rpc.error) throw new Error("SOLANA_RPC_REQUEST_ERROR");
  const value = rpc.result?.value;
  if (value === null || value === undefined) throw new Error("MINT_ACCOUNT_NOT_FOUND");
  return parseSolanaMintAccount(mint, value);
}
