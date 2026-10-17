import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentRequired, createPaymentRequirements, loadX402ReceiveConfig } from "../src/x402/receive-server.js";

const validEnv = {
  X402_RECEIVE_ENABLED: "false",
  X402_RECEIVE_PAY_TO: "0x1111111111111111111111111111111111111111",
  X402_RECEIVE_PRICE_USDC: "0.01",
  X402_FACILITATOR_URL: "https://facilitator.example/",
  X402_PUBLIC_URL: "https://veltrion.example/",
  X402_RECEIVE_PORT: "8787"
};

test("x402 receiver is disabled unless explicitly enabled", () => {
  const config = loadX402ReceiveConfig(validEnv);
  assert.equal(config.enabled, false);
  assert.equal(config.priceAtomic, "10000");
});

test("payment requirements are exact Base mainnet USDC and configured recipient", () => {
  const config = loadX402ReceiveConfig(validEnv);
  const required = createPaymentRequirements(config);
  assert.equal(required.network, "eip155:8453");
  assert.equal(required.amount, "10000");
  assert.equal(required.payTo, validEnv.X402_RECEIVE_PAY_TO);
  assert.equal(required.scheme, "exact");
});

test("payment challenge advertises x402 v2 and the paid resource URL", () => {
  const config = loadX402ReceiveConfig(validEnv);
  const challenge = createPaymentRequired(config);
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.resource.url, "https://veltrion.example/api/paid/summary");
  assert.equal(challenge.accepts.length, 1);
});

test("invalid price, recipient, and insecure public URL fail closed", () => {
  assert.throws(() => loadX402ReceiveConfig({ ...validEnv, X402_RECEIVE_PRICE_USDC: "0" }), /X402_RECEIVE_INVALID_PRICE/);
  assert.throws(() => loadX402ReceiveConfig({ ...validEnv, X402_RECEIVE_PAY_TO: "not-an-address" }), /X402_RECEIVE_INVALID_PAY_TO/);
  assert.throws(() => loadX402ReceiveConfig({ ...validEnv, X402_PUBLIC_URL: "http://veltrion.example/" }), /X402_RECEIVE_PUBLIC_URL_MUST_USE_HTTPS/);
});

test("facilitator URL credentials are rejected", () => {
  assert.throws(() => loadX402ReceiveConfig({ ...validEnv, X402_FACILITATOR_URL: "https://user:pass@facilitator.example/" }), /X402_RECEIVE_URL_CREDENTIALS_FORBIDDEN/);
});
