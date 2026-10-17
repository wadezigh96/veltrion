import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePayBoxPublicResult, summarizeX402Challenge } from "../src/paybox/cli.js";

test("PayBox public discovery sanitizer removes sensitive fields and bounds output", () => {
  const result = sanitizePayBoxPublicResult({
    services: [
      { name: "Solana DeFi data", url: "https://example.invalid/api", description: "Read-only data", credentialId: "should-not-leak" },
      { name: "Paid API", paymentHeader: "should-not-leak", token: "should-not-leak" }
    ],
    privateKey: "should-not-leak"
  }) as Record<string, unknown>;
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("should-not-leak"), false);
  assert.equal(serialized.includes("privateKey"), false);
  assert.equal(serialized.includes("Solana DeFi data"), true);
});

test("PayBox public discovery sanitizer bounds depth and collection size", () => {
  const result = sanitizePayBoxPublicResult({
    items: Array.from({ length: 60 }, (_, i) => ({ index: i }))
  }) as { items: unknown[] };
  assert.equal(result.items.length, 40);
});


test("x402 challenge summary exposes only bounded payment choice fields", () => {
  const summary = summarizeX402Challenge({
    x402Version: 2,
    error: "Payment required",
    accepts: [
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: "20000",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        payTo: "3fPw1ntfRAsTsDtNeJoEyoiTddJePWZ59oRoaRSBShRk",
        maxTimeoutSeconds: 300,
        extra: { feePayer: "must-not-be-returned" }
      },
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "20000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: "0x15773309E68e7d6b561a86bFca8f1bFbf1807D90",
        maxTimeoutSeconds: 300
      }
    ]
  });
  assert.equal(summary.version, 2);
  assert.equal(summary.accepts.length, 2);
  assert.equal(summary.accepts[0].price, "0.02 USDC");
  assert.equal(summary.accepts[1].price, "0.02 USDC");
  assert.equal(JSON.stringify(summary).includes("must-not-be-returned"), false);
});

test("x402 challenge summary rejects malformed or unbounded accepts", () => {
  assert.throws(() => summarizeX402Challenge({ accepts: [] }), /X402_INVALID_ACCEPTS/);
  assert.throws(() => summarizeX402Challenge({ accepts: [{ scheme: "exact", network: "solana", amount: "-1", asset: "USDC", payTo: "wallet" }] }), /X402_INVALID_ACCEPT/);
});
