import test from "node:test";
import assert from "node:assert/strict";
import { normalizeYieldPools } from "../src/defi/opportunities.js";

test("yield scanner filters to the selected chain and minimum TVL", () => {
  const rows = normalizeYieldPools({ data: [
    { pool: "sol-1", project: "Example", chain: "Solana", symbol: "USDC-USDT", tvlUsd: 100_000, apy: 8.5, stablecoin: true },
    { pool: "eth-1", project: "Example", chain: "Ethereum", symbol: "ETH", tvlUsd: 500_000, apy: 20 },
    { pool: "sol-2", project: "Tiny", chain: "Solana", symbol: "TOKEN", tvlUsd: 500, apy: 90 }
  ] }, { minTvlUsd: 10_000, limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.pool, "sol-1");
});

test("yield scanner flags APY outliers instead of ranking them as best", () => {
  const rows = normalizeYieldPools({ data: [
    { pool: "outlier", project: "A", chain: "Solana", symbol: "A", tvlUsd: 1_000_000, apy: 5000 },
    { pool: "normal", project: "B", chain: "Solana", symbol: "B", tvlUsd: 100_000, apy: 12 }
  ] }, { minTvlUsd: 1, limit: 10 });
  assert.equal(rows[0]?.pool, "normal");
  assert.ok(rows[1]?.riskFlags.includes("APY_OUTLIER_VERIFY_BEFORE_USE"));
});

test("yield scanner rejects malformed payload and invalid limits", () => {
  assert.throws(() => normalizeYieldPools({ data: "bad" }), /YIELDS_INVALID_RESPONSE/);
  assert.throws(() => normalizeYieldPools({ data: [] }, { limit: 0 }), /INVALID_POOL_LIMIT/);
  assert.throws(() => normalizeYieldPools({ data: [] }, { minTvlUsd: -1 }), /INVALID_MIN_TVL/);
});

test("yield scanner never invents missing APY values", () => {
  const rows = normalizeYieldPools({ data: [
    { pool: "missing-apy", project: "A", chain: "Solana", symbol: "A", tvlUsd: 25_000 }
  ] }, { minTvlUsd: 1 });
  assert.equal(rows[0]?.apy, null);
  assert.ok(rows[0]?.riskFlags.includes("APY_MISSING_OR_INVALID"));
});
