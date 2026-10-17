import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkDefiRequest } from "./policy.js";
import { getPayBoxCliStatus, discoverPayBoxX402Services, previewPayBoxPoolPayment } from "./paybox/cli.js";
import { discoverPayBoxMcpTools, listPayBoxWallets } from "./paybox/mcp.js";
import { inspectSolanaMint } from "./solana/rpc.js";
import { getSolanaWalletPortfolio } from "./solana/portfolio.js";
import { getVeltrionLlmConfiguration, runVeltrionAgent } from "./llm/agent.js";
import { scanDefiOpportunities } from "./defi/opportunities.js";

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
        paybox: await getPayBoxCliStatus(),
        liveWalletAccess: false,
        executionEnabled: false,
        availableFeatures: ["status", "solana_wallet_portfolio", "paybox_x402_discover", "paybox_x402_preview_pools", "paybox_mcp_discover", "paybox_list_wallets", "solana_token_inspect", "defi_risk_check", "defi_opportunity_scan"],
        note: "Status and service discovery are read-only. Portfolio lookup reads only the public address supplied by the caller, with live Solana RPC and public DexScreener price data. No transaction has been sent."
      }, null, 2)
    }]
  })
);

server.registerTool(
  "solana_wallet_portfolio",
  {
    title: "Solana wallet portfolio and recent activity (read-only)",
    description: "Reads live Solana mainnet SOL/token balances, recent transaction details and token deltas, and estimates USD value from DexScreener liquidity pairs. Transaction categories are heuristic; total USD is null if any token account or native SOL cannot be priced. Does not connect to a wallet, reveal private information, sign, or send transactions.",
    inputSchema: {
      address: z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/).describe("Public Solana wallet address. Never provide a seed phrase or private key."),
      activityLimit: z.number().int().min(1).max(25).optional().describe("Maximum recent signatures to return (default 10, max 25).")
    }
  },
  async ({ address, activityLimit }) => {
    try {
      const result = await getSolanaWalletPortfolio(address, activityLimit ?? 10);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "SOLANA_PORTFOLIO_LOOKUP_FAILED";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            address,
            error: code,
            executionEnabled: false,
            note: "Portfolio lookup failed closed. No transaction was requested."
          }, null, 2)
        }]
      };
    }
  }
);

server.registerTool(
  "paybox_x402_discover",
  {
    title: "Discover PayBox x402 services (live, read-only)",
    description: "Uses the official PayBox CLI's local OAuth/API-key session to discover real Bazaar x402 services. Read-only: never pays a service, fetches a paid endpoint, signs, or broadcasts a transaction. Query is optional and limited to 120 characters.",
    inputSchema: {
      query: z.string().max(120).optional().describe("Optional search phrase for public x402 services.")
    }
  },
  async ({ query }) => ({
    content: [{ type: "text", text: JSON.stringify(await discoverPayBoxX402Services(query ?? ""), null, 2) }]
  })
);

server.registerTool(
  "paybox_x402_preview_pools",
  {
    title: "Preview Solana pool API x402 payment (no payment)",
    description: "Sends one unpaid POST to the fixed Solana DeFi pools endpoint to receive and summarize its live x402 402 challenge. Shows accepted networks and price. Never creates a payment header, uses a wallet credential, retries with payment, signs, or broadcasts. This tool cannot buy data.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("Number of pools to request (default 3)."),
      minTvlUsd: z.number().min(0).max(1_000_000_000).optional().describe("Minimum pool TVL in USD (default 10000).")
    }
  },
  async ({ limit, minTvlUsd }) => ({
    content: [{ type: "text", text: JSON.stringify(await previewPayBoxPoolPayment({ ...(limit === undefined ? {} : { limit }), ...(minTvlUsd === undefined ? {} : { minTvlUsd }) }), null, 2) }]
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


server.registerTool(
  "veltrion_llm_status",
  {
    title: "VELTRION LLM API configuration (read-only)",
    description: "Reports whether the API model and model name are configured locally. Does not call the provider or expose credentials.",
    inputSchema: {}
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(getVeltrionLlmConfiguration(), null, 2) }]
  })
);

server.registerTool(
  "veltrion_ai_agent",
  {
    title: "VELTRION AI DeFi analyst (read-only)",
    description: "Uses the configured Vercel AI Gateway model with a strictly allowlisted set of read-only Solana portfolio, mint inspection, and DeFi risk-check tools. Never pays, signs, or broadcasts. Requires AI_GATEWAY_API_KEY and VELTRION_LLM_MODEL configured locally.",
    inputSchema: {
      message: z.string().trim().min(1).max(4000).describe("Question for the Veltrion DeFi analyst. Never include passwords, API keys, seed phrases, or private keys.")
    }
  },
  async ({ message }) => {
    try {
      const result = await runVeltrionAgent(message);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "LLM_AGENT_FAILED";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: code,
            executionEnabled: false,
            note: code === "LLM_NOT_CONFIGURED"
              ? "Configure AI_GATEWAY_API_KEY and VELTRION_LLM_MODEL locally; no API request was made."
              : "The LLM request failed closed. Provider details and credentials are not exposed; no transaction or payment was made."
          }, null, 2)
        }]
      };
    }
  }
);

server.registerTool(
  "defi_opportunity_scan",
  {
    title: "Scan Solana DeFi yield opportunities (read-only)",
    description: "Fetches public DefiLlama yield/TVL data for Solana, filters by minimum TVL, and flags APY outliers and impermanent-loss/reward risks. Does not inspect private positions, connect a wallet, deposit, stake, sign, or execute transactions.",
    inputSchema: {
      minTvlUsd: z.number().min(0).max(1_000_000_000).optional().describe("Minimum pool TVL in USD (default 10000)."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum opportunities to return (default 20).")
    }
  },
  async ({ minTvlUsd, limit }) => {
    try {
      const result = await scanDefiOpportunities({
        ...(minTvlUsd === undefined ? {} : { minTvlUsd }),
        ...(limit === undefined ? {} : { limit })
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "DEFI_OPPORTUNITY_SCAN_FAILED";
      return { content: [{ type: "text", text: JSON.stringify({
        error: code,
        executionEnabled: false,
        note: "Yield scan failed closed. No wallet or transaction was accessed."
      }, null, 2) }] };
    }
  }
);


const transport = new StdioServerTransport();
await server.connect(transport);
