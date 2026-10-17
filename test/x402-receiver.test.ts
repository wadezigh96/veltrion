import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentRequired, createPaymentRequirements, createX402ReceiveServer, loadX402ReceiveConfig, verifyFacilitatorSupport } from "../src/x402/receive-server.js";

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

test("facilitator must advertise x402 v2 exact Base mainnet", async () => {
  const config = loadX402ReceiveConfig(validEnv);
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  await verifyFacilitatorSupport(config, ok({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }] }));
  await assert.rejects(
    verifyFacilitatorSupport(config, ok({ kinds: [{ x402Version: 1, scheme: "exact", network: "base" }] })),
    /X402_FACILITATOR_UNSUPPORTED_NETWORK/
  );
  await assert.rejects(
    verifyFacilitatorSupport(config, ok({ nope: [] })),
    /X402_FACILITATOR_SUPPORT_INVALID/
  );
});

test("receiver health is available while payment endpoint remains disabled", async () => {
  const config = loadX402ReceiveConfig(validEnv);
  const server = createX402ReceiveServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(new URL("/health", base));
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { enabled: boolean }).enabled, false);
    const paid = await fetch(new URL("/api/paid/summary", base));
    assert.equal(paid.status, 503);
    assert.equal((await paid.json() as { error: string }).error, "X402_RECEIVE_DISABLED");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
