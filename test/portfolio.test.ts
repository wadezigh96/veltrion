import test from "node:test";
import assert from "node:assert/strict";
import { getSolanaWalletPortfolio } from "../src/solana/portfolio.js";

const address = "So11111111111111111111111111111111111111112";

test("portfolio reader rejects malformed public addresses before network access", async () => {
  await assert.rejects(getSolanaWalletPortfolio("not-a-wallet"), /INVALID_WALLET_ADDRESS/);
});

test("portfolio reader bounds activity limit before network access", async () => {
  await assert.rejects(getSolanaWalletPortfolio(address, 0), /INVALID_ACTIVITY_LIMIT/);
  await assert.rejects(getSolanaWalletPortfolio(address, 26), /INVALID_ACTIVITY_LIMIT/);
});

test("portfolio reader never accepts an unsafe activity limit", async () => {
  await assert.rejects(getSolanaWalletPortfolio(address, 1.5), /INVALID_ACTIVITY_LIMIT/);
});
