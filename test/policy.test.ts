import test from "node:test";
import assert from "node:assert/strict";
import { checkDefiRequest } from "../src/policy.js";

const validMint = "So11111111111111111111111111111111111111112";
const validRecipient = "11111111111111111111111111111111";

test("status policy keeps execution disabled", () => {
  const result = checkDefiRequest({
    chain: "solana:mainnet",
    action: "swap",
    amount: "1",
    slippageBps: 100,
    quoteAgeSeconds: 10,
    tokenMint: validMint
  });

  assert.equal(result.allowedForReview, true);
  assert.equal(result.executionEnabled, false);
});

test("rejects unsupported chain", () => {
  const result = checkDefiRequest({
    chain: "eip155:56",
    action: "transfer",
    amount: "1",
    recipient: validRecipient
  });

  assert.equal(result.allowedForReview, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Unsupported chain")));
});

test("rejects zero, negative, and malformed amounts", () => {
  for (const amount of ["0", "-1", "NaN", "1e6", ""]) {
    const result = checkDefiRequest({
      chain: "solana:mainnet",
      action: "transfer",
      amount,
      recipient: validRecipient
    });
    assert.equal(result.allowedForReview, false, `expected rejection for amount: ${amount}`);
  }
});

test("rejects excessive slippage and stale swap quote", () => {
  const result = checkDefiRequest({
    chain: "solana:mainnet",
    action: "swap",
    amount: "1",
    slippageBps: 301,
    quoteAgeSeconds: 61,
    tokenMint: validMint
  });

  assert.equal(result.allowedForReview, false);
  assert.ok(result.reasons.some((reason) => reason.includes("slippage")));
  assert.ok(result.reasons.some((reason) => reason.includes("quote")));
});

test("staking and lending remain disabled pending protocol review", () => {
  for (const action of ["stake", "lend"] as const) {
    const result = checkDefiRequest({
      chain: "solana:mainnet",
      action,
      amount: "1"
    });
    assert.equal(result.allowedForReview, false);
    assert.equal(result.executionEnabled, false);
  }
});

test("transfer requires a recipient", () => {
  const result = checkDefiRequest({
    chain: "solana:mainnet",
    action: "transfer",
    amount: "1"
  });

  assert.equal(result.allowedForReview, false);
  assert.ok(result.reasons.some((reason) => reason.includes("recipient")));
});
