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
      result[key.slice(0, 80)] = redactAndBound(item, depth + 1);
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
