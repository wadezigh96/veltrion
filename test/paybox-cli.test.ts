import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePayBoxPublicResult } from "../src/paybox/cli.js";

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
