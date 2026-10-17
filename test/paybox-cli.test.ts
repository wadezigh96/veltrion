import test from "node:test";
import assert from "node:assert/strict";
import { discoverPayBoxX402Services, getPayBoxCliStatus } from "../src/paybox/cli.js";

test("PayBox x402 discovery has no payment or execution capability", async () => {
  const result = await discoverPayBoxX402Services(" ");
  assert.equal(result.executionEnabled, false);
  assert.equal(result.query, "");
  assert.ok(["discovered", "error"].includes(result.connection));
  assert.equal(JSON.stringify(result).includes("X-PAYMENT"), false);
});

test("PayBox CLI status is read-only and never enables execution", async () => {
  const result = await getPayBoxCliStatus();
  assert.equal(result.executionEnabled, false);
  assert.ok(["authenticated", "not-configured", "error"].includes(result.connection));
  assert.equal(JSON.stringify(result).includes("configFile"), false);
});
