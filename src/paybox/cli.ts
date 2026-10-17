import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PAYBOX_PACKAGE = "@paybox-sh/sdk@2.2.0";
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 24_000;

async function runPayBox(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(
    "npx",
    ["--yes", PAYBOX_PACKAGE, "--json", ...args],
    { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, encoding: "utf8" }
  );
  return { stdout: result.stdout, stderr: result.stderr };
}

function parseJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed.length > MAX_OUTPUT) throw new Error("PAYBOX_INVALID_OUTPUT");
  try { return JSON.parse(trimmed) as unknown; }
  catch { throw new Error("PAYBOX_INVALID_JSON"); }
}

const SENSITIVE_KEY = /token|secret|private.?key|authorization|password|credential|payment.?header|x-payment/i;

export function sanitizePayBoxPublicResult(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitizePayBoxPublicResult(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      if (SENSITIVE_KEY.test(key)) continue;
      result[key.slice(0, 80)] = sanitizePayBoxPublicResult(item, depth + 1);
    }
    return result;
  }
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

export type PayBoxCliStatus = {
  connection: "configured" | "not-configured" | "error";
  auth: "oauth" | "api-key" | "unknown";
  canSign: boolean;
  executionEnabled: false;
  detail: string;
};

export async function getPayBoxCliStatus(): Promise<PayBoxCliStatus> {
  try {
    const raw = parseJson((await runPayBox(["whoami"])).stdout);
    if (!raw || typeof raw !== "object") throw new Error("PAYBOX_INVALID_STATUS");
    const status = raw as Record<string, unknown>;
    const auth = status.auth === "oauth" || status.auth === "api-key" ? status.auth : "unknown";
    const baseUrl = status.baseUrl;
    if (typeof baseUrl !== "string" || !baseUrl.startsWith("https://api.paybox.sh")) {
      return { connection: "error", auth, canSign: false, executionEnabled: false, detail: "PayBox CLI endpoint was not the expected official HTTPS endpoint." };
    }
    return {
      connection: auth === "unknown" ? "not-configured" : "configured",
      auth,
      canSign: status.canSign === true,
      executionEnabled: false,
      detail: "Read-only CLI configuration status checked. This does not verify token freshness or call the remote API; no wallet action or payment was requested."
    };
  } catch {
    return {
      connection: "not-configured",
      auth: "unknown",
      canSign: false,
      executionEnabled: false,
      detail: "PayBox CLI status could not be verified. Confirm local PayBox CLI login; no payment was requested."
    };
  }
}

export async function discoverPayBoxX402Services(query = ""): Promise<{
  connection: "discovered" | "error";
  executionEnabled: false;
  query: string;
  results: unknown;
  detail: string;
}> {
  const normalizedQuery = query.trim().slice(0, 120);
  try {
    const args = ["discover"];
    if (normalizedQuery) args.push(normalizedQuery);
    const raw = parseJson((await runPayBox(args)).stdout);
    return {
      connection: "discovered",
      executionEnabled: false,
      query: normalizedQuery,
      results: sanitizePayBoxPublicResult(raw),
      detail: "Live PayBox Bazaar discovery completed. This operation is read-only; no x402 endpoint was paid or fetched."
    };
  } catch {
    return {
      connection: "error",
      executionEnabled: false,
      query: normalizedQuery,
      results: [],
      detail: "PayBox service discovery failed or returned an unsupported response. No payment was requested; check CLI login and network access."
    };
  }
}


const SOLDEFI_POOLS_URL = "https://soldefi.thomenz.me/v1/solana/pools/top";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_MAINNET = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

type X402Accept = {
  scheme?: unknown;
  network?: unknown;
  amount?: unknown;
  asset?: unknown;
  payTo?: unknown;
  maxTimeoutSeconds?: unknown;
};

export function summarizeX402Challenge(value: unknown): {
  version: number | null;
  accepts: Array<{
    scheme: string;
    network: string;
    amountAtomic: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number | null;
    price: string | null;
  }>;
} {
  if (!value || typeof value !== "object") throw new Error("X402_INVALID_CHALLENGE");
  const challenge = value as Record<string, unknown>;
  const rawAccepts = challenge.accepts;
  if (!Array.isArray(rawAccepts) || rawAccepts.length === 0 || rawAccepts.length > 10) {
    throw new Error("X402_INVALID_ACCEPTS");
  }
  const accepts = rawAccepts.map((item): {
    scheme: string;
    network: string;
    amountAtomic: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number | null;
    price: string | null;
  } => {
    if (!item || typeof item !== "object") throw new Error("X402_INVALID_ACCEPT");
    const a = item as X402Accept;
    if (
      a.scheme !== "exact" ||
      typeof a.network !== "string" ||
      typeof a.amount !== "string" ||
      !/^\\d{1,40}$/.test(a.amount) ||
      typeof a.asset !== "string" ||
      typeof a.payTo !== "string"
    ) throw new Error("X402_INVALID_ACCEPT");
    let price: string | null = null;
    if ((a.network === SOLANA_MAINNET && a.asset === SOLANA_USDC) ||
        (a.network === BASE_MAINNET && a.asset.toLowerCase() === BASE_USDC.toLowerCase())) {
      const atomic = BigInt(a.amount);
      const whole = atomic / 1_000_000n;
      const fraction = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
      price = fraction ? `${whole}.${fraction} USDC` : `${whole} USDC`;
    }
    return {
      scheme: "exact",
      network: a.network.slice(0, 80),
      amountAtomic: a.amount,
      asset: a.asset.slice(0, 100),
      payTo: a.payTo.slice(0, 120),
      maxTimeoutSeconds: typeof a.maxTimeoutSeconds === "number" && Number.isInteger(a.maxTimeoutSeconds) && a.maxTimeoutSeconds > 0 && a.maxTimeoutSeconds <= 3600
        ? a.maxTimeoutSeconds : null,
      price
    };
  });
  return {
    version: typeof challenge.x402Version === "number" ? challenge.x402Version : null,
    accepts
  };
}

function decodePaymentRequiredHeader(header: string): unknown {
  if (!header || header.length > 48_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) {
    throw new Error("X402_INVALID_HEADER");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as unknown;
  } catch {
    throw new Error("X402_INVALID_CHALLENGE_JSON");
  }
  return parsed;
}

export async function previewPayBoxPoolPayment(input: {
  limit?: number;
  minTvlUsd?: number;
}): Promise<Record<string, unknown>> {
  const limit = input.limit ?? 3;
  const minTvlUsd = input.minTvlUsd ?? 10_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isFinite(minTvlUsd) || minTvlUsd < 0 || minTvlUsd > 1_000_000_000) {
    return {
      connection: "error",
      executionEnabled: false,
      detail: "Invalid pool query. limit must be 1–50 and minTvlUsd must be between 0 and 1,000,000,000."
    };
  }

  try {
    const response = await fetch(SOLDEFI_POOLS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ limit, minTvlUsd }),
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status !== 402) {
      return {
        connection: "unexpected-response",
        endpoint: SOLDEFI_POOLS_URL,
        httpStatus: response.status,
        request: { limit, minTvlUsd },
        executionEnabled: false,
        detail: "No payment was sent. The endpoint did not return the expected HTTP 402 challenge, so no paid retry was attempted."
      };
    }
    const header = response.headers.get("payment-required");
    if (!header) {
      return {
        connection: "error",
        endpoint: SOLDEFI_POOLS_URL,
        httpStatus: 402,
        executionEnabled: false,
        detail: "The endpoint returned HTTP 402 without a Payment-Required header. No payment was sent."
      };
    }
    const challenge = decodePaymentRequiredHeader(header) as Record<string, unknown>;
    const summary = summarizeX402Challenge(challenge);
    return {
      connection: "challenge-received",
      endpoint: SOLDEFI_POOLS_URL,
      httpStatus: 402,
      request: { limit, minTvlUsd },
      challenge: summary,
      executionEnabled: false,
      paymentSent: false,
      detail: "Live x402 payment challenge parsed. This is a preview only: no credential was used, no X-PAYMENT header was generated, and no payment or blockchain transaction was sent."
    };
  } catch {
    return {
      connection: "error",
      endpoint: SOLDEFI_POOLS_URL,
      executionEnabled: false,
      paymentSent: false,
      detail: "Could not safely retrieve or parse the x402 challenge. No payment was sent."
    };
  }
}
