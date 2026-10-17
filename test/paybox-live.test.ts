import test from "node:test";
import assert from "node:assert/strict";
import { discoverPayBoxMcpTools, summarizeMcpTools } from "../src/paybox/mcp.js";

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
