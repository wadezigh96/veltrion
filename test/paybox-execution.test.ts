import test from "node:test";
import assert from "node:assert/strict";
import { getPayBoxExecutionStatus, requestPayBoxSolanaSwap, requestPayBoxSolanaTransfer } from "../src/paybox/execution.js";

test("PayBox money movement is disabled unless the explicit server feature flag and token are configured", () => {
  const status = getPayBoxExecutionStatus({});
  assert.equal(status.configured, false);
  assert.equal(status.executionEnabled, false);
});

test("swap request fails closed when execution is disabled", async () => {
  const oldFlag = process.env.VELTRION_PAYBOX_EXECUTION_ENABLED;
  const oldToken = process.env.PAYBOX_ACCESS_TOKEN;
  try {
    delete process.env.VELTRION_PAYBOX_EXECUTION_ENABLED;
    delete process.env.PAYBOX_ACCESS_TOKEN;
    await assert.rejects(requestPayBoxSolanaSwap({
      credentialId: "test", srcToken: "native", dstToken: "native",
      amount: "1000", slippageBps: 100, confirmed: true
    }), /PAYBOX_EXECUTION_DISABLED/);
  } finally {
    if (oldFlag === undefined) delete process.env.VELTRION_PAYBOX_EXECUTION_ENABLED;
    else process.env.VELTRION_PAYBOX_EXECUTION_ENABLED = oldFlag;
    if (oldToken === undefined) delete process.env.PAYBOX_ACCESS_TOKEN;
    else process.env.PAYBOX_ACCESS_TOKEN = oldToken;
  }
});

test("transfer request fails closed when execution is disabled", async () => {
  const oldFlag = process.env.VELTRION_PAYBOX_EXECUTION_ENABLED;
  const oldToken = process.env.PAYBOX_ACCESS_TOKEN;
  try {
    delete process.env.VELTRION_PAYBOX_EXECUTION_ENABLED;
    delete process.env.PAYBOX_ACCESS_TOKEN;
    await assert.rejects(requestPayBoxSolanaTransfer({
      credentialId: "test", to: "So11111111111111111111111111111111111111112",
      amount: "1000", confirmed: true
    }), /PAYBOX_EXECUTION_DISABLED/);
  } finally {
    if (oldFlag === undefined) delete process.env.VELTRION_PAYBOX_EXECUTION_ENABLED;
    else process.env.VELTRION_PAYBOX_EXECUTION_ENABLED = oldFlag;
    if (oldToken === undefined) delete process.env.PAYBOX_ACCESS_TOKEN;
    else process.env.PAYBOX_ACCESS_TOKEN = oldToken;
  }
});
