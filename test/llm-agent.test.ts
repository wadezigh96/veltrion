import test from "node:test";
import assert from "node:assert/strict";
import { getVeltrionAllowedToolNames, getVeltrionLlmConfiguration } from "../src/llm/agent.js";

test("LLM agent exposes only the explicitly approved read-only tools", () => {
  assert.deepEqual(getVeltrionAllowedToolNames(), [
    "solana_wallet_portfolio",
    "solana_token_inspect",
    "defi_risk_check"
  ]);
  assert.ok(!getVeltrionAllowedToolNames().some((name) => /execute|transfer_execute|swap_execute|paybox|payment/i.test(name)));
});

test("LLM config status fails closed when configuration is absent", () => {
  const oldKey = process.env.AI_GATEWAY_API_KEY;
  const oldModel = process.env.VELTRION_LLM_MODEL;
  try {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VELTRION_LLM_MODEL;
    const status = getVeltrionLlmConfiguration();
    assert.equal(status.configured, false);
    assert.equal(status.executionEnabled, false);
    assert.match(status.detail, /No API request was made/);
  } finally {
    if (oldKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.VELTRION_LLM_MODEL;
    else process.env.VELTRION_LLM_MODEL = oldModel;
  }
});
