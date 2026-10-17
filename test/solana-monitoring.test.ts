import test from "node:test";
import assert from "node:assert/strict";
import { monitorNativeSolanaStake } from "../src/solana/staking.js";
import { getSolanaTransactionStatus } from "../src/solana/transaction-status.js";

test("native staking monitor rejects invalid addresses before network access", async () => {
  await assert.rejects(monitorNativeSolanaStake("bad-address"), /INVALID_WALLET_ADDRESS/);
});

test("transaction status monitor rejects malformed signatures before network access", async () => {
  await assert.rejects(getSolanaTransactionStatus("not-a-signature"), /INVALID_TRANSACTION_SIGNATURE/);
});
