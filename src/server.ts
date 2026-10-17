import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkDefiRequest } from "./policy.js";
import { MockPayBoxAdapter } from "./paybox/adapter.js";
import { discoverPayBoxMcpTools, listPayBoxWallets } from "./paybox/mcp.js";
import { inspectSolanaMint } from "./solana/rpc.js";

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
        availableFeatures: ["status", "paybox_mcp_discover", "paybox_list_wallets", "solana_token_inspect", "defi_risk_check"],
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
  "paybox_list_wallets",
  {
    title: "List PayBox wallets (read-only)",
    description: "Calls only PayBox's read-only list_credentials tool and returns allowlisted wallet metadata. Does not expose cards/secrets, request signatures, or move funds.",
    inputSchema: {}
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify(await listPayBoxWallets(), null, 2)
    }]
  })
);

server.registerTool(
  "solana_token_inspect",
  {
    title: "Inspect Solana token mint",
    description: "Read the confirmed Solana mint account and report token program, decimals, atomic supply, initialization, and authority flags. Read-only; never signs or sends transactions.",
    inputSchema: {
      mint: z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/).describe("Solana SPL or Token-2022 mint address.")
    }
  },
  async ({ mint }) => {
    try {
      return {
        content: [{ type: "text", text: JSON.stringify(await inspectSolanaMint(mint), null, 2) }]
      };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "SOLANA_INSPECTION_FAILED";
      return {
        content: [{ type: "text", text: JSON.stringify({
          mint,
          error: code,
          executionEnabled: false,
          note: "Inspection failed closed. No transaction was requested."
        }, null, 2) }]
      };
    }
  }
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
