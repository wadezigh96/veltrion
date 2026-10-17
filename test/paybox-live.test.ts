import test from "node:test";
import assert from "node:assert/strict";
import { isCredentialListResponse, summarizePayBoxCredentials } from "../src/paybox/live.js";

test("credential sanitizer returns only a bounded metadata allowlist", () => {
  const result = summarizePayBoxCredentials({
    credentials: [{
      name: "Solana Wallet",
      kind: "wallet",
      credential: { id: "cred_123", secret: "must-not-escape" },
      access_token: "must-not-escape",
      private_key: "must-not-escape"
    }]
  });

  assert.deepEqual(result, [{ id: "cred_123", name: "Solana Wallet", kind: "wallet" }]);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("credential sanitizer handles malformed provider data safely", () => {
  assert.deepEqual(summarizePayBoxCredentials(null), []);
  assert.deepEqual(summarizePayBoxCredentials({ credentials: "not-an-array" }), []);
  assert.deepEqual(summarizePayBoxCredentials({ credentials: [{}] }), [
    { id: "unknown-1", name: "Unnamed credential", kind: "unknown" }
  ]);
});

test("credential sanitizer caps the number of displayed records", () => {
  const credentials = Array.from({ length: 80 }, (_, i) => ({
    name: `Wallet ${i}`,
    kind: "wallet",
    credential: { id: `cred_${i}` }
  }));
  assert.equal(summarizePayBoxCredentials({ credentials }).length, 50);
});

test("connection response validator rejects malformed data instead of implying authentication", () => {
  assert.equal(isCredentialListResponse(null), false);
  assert.equal(isCredentialListResponse({}), false);
  assert.equal(isCredentialListResponse({ credentials: "unexpected" }), false);
  assert.equal(isCredentialListResponse({ credentials: [] }), true);
});
