import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkDefiRequest } from "./policy.js";
import { MockPayBoxAdapter } from "./paybox/adapter.js";
import { discoverPayBoxMcpTools } from "./paybox/mcp.js";

const paybox = new MockPayBoxAdapter();

const server = new McpServer({
  name: "veltrion",
  version: "0.1.0"
});

server.registerTool(
  "veltrion_status",
  {
    title: "VELTRION status",
    description: "Read-only status of VELTRION. Reports integration and execution state without accessing a wallet.",
    inputSchema: {}
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        name: "VELTRION",
        networkScope: "Solana",
        payboxExecutionAdapter: paybox.status(),
        liveWalletAccess: false,
        executionEnabled: false,
        availableFeatures: ["status", "paybox_mcp_discover", "defi_risk_check"],
        note: "No wallet has been accessed and no transaction has been sent."
      }, null, 2)
    }]
  })
);

server.registerTool(
  "paybox_mcp_discover",
  {
    title: "Discover PayBox MCP tools (read-only)",
    description: "Uses local PAYBOX_ACCESS_TOKEN to connect to the official PayBox MCP endpoint and list tool names/descriptions only. Does not call discovered tools or execute transactions.",
    inputSchema: {}
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify(await discoverPayBoxMcpTools(), null, 2)
    }]
  })
);

server.registerTool(
  "defi_risk_check",
  {
    title: "Check DeFi request risk",
    description: "Validate a proposed Solana DeFi request. This tool never signs, broadcasts, or executes a transaction.",
    inputSchema: {
      chain: z.string().describe('Expected "solana:mainnet" for this initial policy.'),
      action: z.enum(["swap", "transfer", "stake", "lend"]),
      amount: z.string().describe("Positive decimal amount, represented as a string."),
      slippageBps: z.number().int().optional(),
      quoteAgeSeconds: z.number().int().optional(),
      recipient: z.string().optional(),
      tokenMint: z.string().optional()
    }
  },
  async (input) => {
    const result = checkDefiRequest(input);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...result,
          note: "allowedForReview is not transaction authorization. Execution is disabled."
        }, null, 2)
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
