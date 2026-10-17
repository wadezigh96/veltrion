import test from "node:test";
import assert from "node:assert/strict";
import { MockPayBoxAdapter, UnconfiguredPayBoxAdapter } from "../src/paybox/adapter.js";

const intent = {
  chain: "solana:mainnet" as const,
  inputToken: "So11111111111111111111111111111111111111112",
  outputToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amountAtomic: "1000000",
  slippageBps: 100
};

test("mock adapter reports no wallet and execution disabled", () => {
  const adapter = new MockPayBoxAdapter();
  const status = adapter.status();

  assert.equal(status.connection, "mock-only");
  assert.equal(status.walletAccess, false);
  assert.equal(status.executionEnabled, false);
});

test("mock adapter never submits a real swap", async () => {
  const adapter = new MockPayBoxAdapter();
  await assert.rejects(adapter.requestSwap(intent), /PAYBOX_LIVE_INTEGRATION_DISABLED/);
});

test("unconfigured adapter fails closed", async () => {
  const adapter = new UnconfiguredPayBoxAdapter();
  const status = adapter.status();

  assert.equal(status.connection, "not-configured");
  assert.equal(status.executionEnabled, false);
  await assert.rejects(adapter.requestSwap(intent), /PAYBOX_NOT_CONFIGURED/);
});
