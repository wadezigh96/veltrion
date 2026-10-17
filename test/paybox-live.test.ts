import test from "node:test";
import assert from "node:assert/strict";
import { discoverPayBoxMcpTools, listPayBoxWallets, summarizeMcpTools, summarizePayBoxWallets } from "../src/paybox/mcp.js";

test("MCP tool discovery sanitizer returns only bounded names and descriptions", () => {
  const result = summarizeMcpTools({
    tools: [
      { name: "get_portfolio", description: "Read-only balances", inputSchema: { secret: "must-not-escape" } },
      { name: "request_swap", description: "Money-moving tool" }
    ]
  });
  assert.deepEqual(result, [
    { name: "get_portfolio", description: "Read-only balances" },
    { name: "request_swap", description: "Money-moving tool" }
  ]);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("direct MCP discovery without a token fails closed without network access", async () => {
  const result = await discoverPayBoxMcpTools("");
  assert.equal(result.connection, "not-configured");
  assert.equal(result.toolCount, 0);
  assert.equal(result.executionEnabled, false);
});

test("wallet summary includes only allowlisted wallet metadata", () => {
  const result = summarizePayBoxWallets({
    credentials: [
      {
        credential_id: "wallet-123",
        name: "Solana Main",
        kind: "wallet",
        approval_mode: "passkey",
        metadata: { address: "So11111111111111111111111111111111111111112", chains: ["solana:mainnet"] },
        secret: "must-not-escape"
      },
      { credential_id: "card-1", name: "Card", kind: "card", last4: "1234" },
      { credential_id: "secret-1", name: "Secret", kind: "secret", value: "must-not-escape" }
    ]
  });
  assert.deepEqual(result, [{
    credentialId: "wallet-123",
    name: "Solana Main",
    approvalMode: "passkey",
    address: "So11111111111111111111111111111111111111112",
    chains: ["solana:mainnet"]
  }]);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("wallet listing without token fails closed without network access", async () => {
  const result = await listPayBoxWallets("");
  assert.equal(result.connection, "not-configured");
  assert.deepEqual(result.wallets, []);
  assert.equal(result.executionEnabled, false);
});
