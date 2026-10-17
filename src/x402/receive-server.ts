import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const BASE_NETWORK = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAX_BODY_BYTES = 64_000;

export type X402ReceiveConfig = {
  enabled: boolean;
  payTo: string;
  priceAtomic: string;
  facilitatorUrl: URL;
  publicUrl: URL;
  host: string;
  port: number;
};

export function loadX402ReceiveConfig(env: NodeJS.ProcessEnv = process.env): X402ReceiveConfig {
  const enabled = env.X402_RECEIVE_ENABLED === "true";
  // The receiver must be runnable in its default disabled state without payment configuration.
  // These inert defaults are never advertised as payment requirements while enabled=false.
  const payTo = env.X402_RECEIVE_PAY_TO?.trim() || (enabled ? "" : "0x0000000000000000000000000000000000000001");
  const price = env.X402_RECEIVE_PRICE_USDC?.trim() || (enabled ? "" : "0.01");
  const facilitatorRaw = env.X402_FACILITATOR_URL?.trim() || "https://facilitator.payai.network/";
  const publicRaw = env.X402_PUBLIC_URL?.trim() || (enabled ? "" : "https://localhost.invalid/");
  const host = env.X402_RECEIVE_HOST?.trim() || "127.0.0.1";
  const port = Number(env.X402_RECEIVE_PORT ?? "8787");

  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) throw new Error("X402_RECEIVE_INVALID_PAY_TO");
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,6})?$/.test(price) || Number(price) <= 0) {
    throw new Error("X402_RECEIVE_INVALID_PRICE");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("X402_RECEIVE_INVALID_PORT");
  const facilitatorUrl = new URL(facilitatorRaw);
  const publicUrl = new URL(publicRaw);
  if (facilitatorUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(facilitatorUrl.hostname)) {
    throw new Error("X402_RECEIVE_FACILITATOR_MUST_USE_HTTPS");
  }
  if (publicUrl.protocol !== "https:") throw new Error("X402_RECEIVE_PUBLIC_URL_MUST_USE_HTTPS");
  if (facilitatorUrl.username || facilitatorUrl.password || publicUrl.username || publicUrl.password) {
    throw new Error("X402_RECEIVE_URL_CREDENTIALS_FORBIDDEN");
  }
  const [whole = "0", fraction = ""] = price.split(".");
  const priceAtomic = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0")).toString();
  return { enabled, payTo, priceAtomic, facilitatorUrl, publicUrl, host, port };
}

export async function verifyFacilitatorSupport(
  config: X402ReceiveConfig,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const supportedUrl = new URL("supported", config.facilitatorUrl.toString().endsWith("/")
    ? config.facilitatorUrl
    : new URL(config.facilitatorUrl.toString() + "/"));
  let response: Response;
  try {
    response = await fetcher(supportedUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new Error("X402_FACILITATOR_SUPPORT_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("X402_FACILITATOR_SUPPORT_UNAVAILABLE");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error("X402_FACILITATOR_SUPPORT_INVALID"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("X402_FACILITATOR_SUPPORT_INVALID");
  const kinds = (body as Record<string, unknown>).kinds;
  if (!Array.isArray(kinds)) throw new Error("X402_FACILITATOR_SUPPORT_INVALID");
  const supported = kinds.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const kind = item as Record<string, unknown>;
    return kind.x402Version === 2 && kind.scheme === "exact" && kind.network === BASE_NETWORK;
  });
  if (!supported) throw new Error("X402_FACILITATOR_UNSUPPORTED_NETWORK");
}

export function createPaymentRequirements(config: X402ReceiveConfig) {
  return {
    scheme: "exact",
    network: BASE_NETWORK,
    amount: config.priceAtomic,
    asset: BASE_USDC,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" }
  };
}

export function createPaymentRequired(config: X402ReceiveConfig) {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: new URL("/api/paid/summary", config.publicUrl).toString(),
      description: "VELTRION paid sample DeFi market summary",
      mimeType: "application/json",
      serviceName: "VELTRION"
    },
    accepts: [createPaymentRequirements(config)],
    extensions: {}
  };
}

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeHeader(value: string): unknown {
  if (!value || value.length > MAX_BODY_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("X402_INVALID_PAYMENT_HEADER");
  }
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("X402_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  if (!size) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function facilitatorCall(base: URL, operation: "verify" | "settle", payload: unknown, requirements: unknown): Promise<Record<string, unknown>> {
  const url = new URL(operation, base.toString().endsWith("/") ? base : new URL(base.toString() + "/"));
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    redirect: "error",
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error("X402_FACILITATOR_UNAVAILABLE");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("X402_FACILITATOR_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function matchesRequirements(payload: unknown, expected: ReturnType<typeof createPaymentRequirements>): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  if (value.x402Version !== 2 || !value.accepted || typeof value.accepted !== "object" || Array.isArray(value.accepted)) return false;
  const accepted = value.accepted as Record<string, unknown>;
  return accepted.scheme === expected.scheme &&
    accepted.network === expected.network &&
    accepted.amount === expected.amount &&
    typeof accepted.asset === "string" && accepted.asset.toLowerCase() === expected.asset.toLowerCase() &&
    typeof accepted.payTo === "string" && accepted.payTo.toLowerCase() === expected.payTo.toLowerCase();
}

export function createX402ReceiveServer(config: X402ReceiveConfig) {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, {
          service: "VELTRION x402 receiver",
          enabled: config.enabled,
          protocol: "x402-v2",
          network: BASE_NETWORK,
          paymentExecutionEnabled: config.enabled,
          note: "Health check only; no wallet is accessed and no payment is initiated."
        });
      }
      if (req.method !== "GET" || req.url !== "/api/paid/summary") {
        return sendJson(res, 404, { error: "NOT_FOUND" });
      }
      if (!config.enabled) return sendJson(res, 503, { error: "X402_RECEIVE_DISABLED", paymentExecutionEnabled: false });
      const requirements = createPaymentRequirements(config);
      const paymentRequired = createPaymentRequired(config);
      const header = req.headers["payment-signature"];
      if (typeof header !== "string") {
        return sendJson(res, 402, paymentRequired, { "payment-required": encodeHeader(paymentRequired) });
      }

      let paymentPayload: unknown;
      try { paymentPayload = decodeHeader(header); }
      catch { return sendJson(res, 402, { ...paymentRequired, error: "INVALID_PAYMENT_SIGNATURE" }, { "payment-required": encodeHeader(paymentRequired) }); }
      if (!matchesRequirements(paymentPayload, requirements)) {
        return sendJson(res, 402, { ...paymentRequired, error: "PAYMENT_REQUIREMENTS_MISMATCH" }, { "payment-required": encodeHeader(paymentRequired) });
      }

      let verification: Record<string, unknown>;
      try { verification = await facilitatorCall(config.facilitatorUrl, "verify", paymentPayload, requirements); }
      catch { return sendJson(res, 503, { error: "PAYMENT_VERIFICATION_UNAVAILABLE", paymentExecutionEnabled: false }); }
      if (verification.isValid !== true) {
        return sendJson(res, 402, { ...paymentRequired, error: "PAYMENT_NOT_VALID" }, { "payment-required": encodeHeader(paymentRequired) });
      }

      // Build the resource only after verification; settle before disclosing it.
      const resource = {
        service: "VELTRION",
        type: "sample-market-summary",
        network: BASE_NETWORK,
        generatedAt: new Date().toISOString(),
        data: {
          status: "demo",
          message: "This is a sample paid endpoint. Replace this payload with reviewed, sourced market data before production."
        }
      };
      let settlement: Record<string, unknown>;
      try { settlement = await facilitatorCall(config.facilitatorUrl, "settle", paymentPayload, requirements); }
      catch { return sendJson(res, 503, { error: "PAYMENT_SETTLEMENT_UNKNOWN", contentReleased: false, retryPolicy: "Do not resubmit payment; reconcile with the facilitator." }); }
      if (settlement.success !== true) {
        return sendJson(res, 503, {
          error: settlement.errorReason === "settlement_pending" ? "PAYMENT_SETTLEMENT_PENDING" : "PAYMENT_SETTLEMENT_FAILED",
          contentReleased: false,
          transaction: typeof settlement.transaction === "string" ? settlement.transaction : null,
          network: typeof settlement.network === "string" ? settlement.network : BASE_NETWORK,
          retryPolicy: "Do not submit a second payment for this request; reconcile the same payment first."
        });
      }
      return sendJson(res, 200, resource, { "payment-response": encodeHeader(settlement) });
    } catch {
      if (!res.headersSent) sendJson(res, 400, { error: "INVALID_REQUEST" });
      else res.destroy();
    }
  });
}
