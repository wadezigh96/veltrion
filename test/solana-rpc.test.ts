import test from "node:test";
import assert from "node:assert/strict";
import { parseSolanaMintAccount } from "../src/solana/rpc.js";

const mint = "So11111111111111111111111111111111111111112";
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const token2022Program = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function makeAccount(options: { owner?: string; decimals?: number; supply?: bigint; initialized?: number } = {}) {
  const bytes = Buffer.alloc(82);
  bytes.writeUInt32LE(1, 0); // mint authority present
  bytes.writeBigUInt64LE(options.supply ?? 1_000_000_000n, 36);
  bytes[44] = options.decimals ?? 9;
  bytes[45] = options.initialized ?? 1;
  bytes.writeUInt32LE(0, 46); // no freeze authority
  return {
    owner: options.owner ?? tokenProgram,
    lamports: 1_461_600,
    executable: false,
    data: [bytes.toString("base64"), "base64"]
  };
}

test("parses SPL mint metadata without converting supply to floating point", () => {
  const result = parseSolanaMintAccount(mint, makeAccount({ supply: 9_007_199_254_740_993n }));
  assert.equal(result.tokenProgram, "spl-token");
  assert.equal(result.decimals, 9);
  assert.equal(result.supplyAtomic, "9007199254740993");
  assert.equal(result.initialized, true);
  assert.equal(result.mintAuthorityEnabled, true);
  assert.equal(result.freezeAuthorityEnabled, false);
  assert.equal(result.executionEnabled, false);
});

test("recognizes Token-2022 mint owner", () => {
  const result = parseSolanaMintAccount(mint, makeAccount({ owner: token2022Program, decimals: 6 }));
  assert.equal(result.tokenProgram, "token-2022");
  assert.equal(result.decimals, 6);
});

test("rejects malformed mint addresses, unknown owners, and short account data", () => {
  assert.throws(() => parseSolanaMintAccount("bad", makeAccount()), /INVALID_MINT_FORMAT/);
  assert.throws(() => parseSolanaMintAccount(mint, makeAccount({ owner: "unknown-program" })), /UNSUPPORTED_MINT_OWNER/);
  assert.throws(() => parseSolanaMintAccount(mint, { ...makeAccount(), data: [Buffer.alloc(10).toString("base64"), "base64"] }), /INVALID_MINT_DATA_LENGTH/);
});

test("rejects invalid initialization byte", () => {
  assert.throws(() => parseSolanaMintAccount(mint, makeAccount({ initialized: 2 })), /INVALID_MINT_LAYOUT/);
});
