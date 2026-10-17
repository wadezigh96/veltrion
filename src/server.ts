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
import { monitorNativeSolanaStake } from "./solana/staking.js";
import { getSolanaTransactionStatus } from "./solana/transaction-status.js";
import { getPayBoxExecutionStatus, getPayBoxRequestStatus, requestPayBoxSolanaSwap, requestPayBoxSolanaTransfer } from "./paybox/execution.js";

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
        paybox: await getPayBoxCliStatus(),\n        payboxExecution: getPayBoxExecutionStatus(),
        liveWalletAccess: false,
        executionEnabled: false,
        availableFeatures: ["status", "solana_wallet_portfolio", "paybox_x402_discover", "paybox_x402_preview_pools", "paybox_mcp_discover", "paybox_list_wallets", "solana_token_inspect", "defi_risk_check", "defi_opportunity_scan", "solana_native_staking_monitor", "solana_transaction_status", "paybox_request_swap", "paybox_request_transfer", "paybox_request_status"],
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


server.registerTool(
  "solana_native_staking_monitor",
  {
    title: "Monitor native Solana staking positions (read-only)",
    description: "Reads native Solana stake-program accounts where the public wallet is staker or withdrawer and checks activation status. Does not include liquid-staking tokens or third-party LP farms and never stakes, unstake, signs, or sends.",
    inputSchema: {
      address: z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/).describe("Public Solana wallet address only. Never provide a seed phrase or private key.")
    }
  },
  async ({ address }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await monitorNativeSolanaStake(address), null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "SOLANA_STAKING_MONITOR_FAILED";
      return { content: [{ type: "text", text: JSON.stringify({ address, error: code, executionEnabled: false, note: "Staking monitor failed closed; no transaction was sent." }, null, 2) }] };
    }
  }
);


server.registerTool(
  "solana_transaction_status",
  {
    title: "Check Solana transaction status (read-only)",
    description: "Checks the current status of a known Solana mainnet transaction signature using RPC history lookup. It does not submit or retry transactions.",
    inputSchema: {
      signature: z.string().min(80).max(90).regex(/^[1-9A-HJ-NP-Za-km-z]+$/).describe("Public Solana transaction signature, not a private key.")
    }
  },
  async ({ signature }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await getSolanaTransactionStatus(signature), null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "SOLANA_TRANSACTION_STATUS_FAILED";
      return { content: [{ type: "text", text: JSON.stringify({ signature, error: code, executionEnabled: false, note: "Status lookup failed; do not infer success or submit a duplicate transaction." }, null, 2) }] };
    }
  }
);


server.registerTool(
  "paybox_request_swap",
  {
    title: "Request a Solana swap through PayBox",
    description: "REAL-FUNDS OPERATION. Requests a swap through the authenticated PayBox MCP session. Only call when the user explicitly asks for this exact swap and confirms the token mints, atomic amount, slippage, and wallet. Disabled unless VELTRION_PAYBOX_EXECUTION_ENABLED=true and PAYBOX_ACCESS_TOKEN is configured. PayBox's own wallet approval/signing flow remains authoritative. Never retry the same request; use paybox_request_status.",
    inputSchema: {
      credentialId: z.string().trim().min(1).max(200).describe("Granted PayBox wallet credential ID from paybox_list_wallets."),
      srcToken: z.string().min(1).max(44).describe('Source SPL mint address or "native" for SOL.'),
      dstToken: z.string().min(1).max(44).describe('Destination SPL mint address or "native" for SOL.'),
      amount: z.string().regex(/^[1-9]\\d{0,39}$/).describe("Exact source-token atomic units; not a decimal UI amount."),
      slippageBps: z.number().int().min(0).max(300).describe("Slippage tolerance in basis points; max 300 bps (3%)."),
      confirmed: z.literal(true).describe("Must be true only after the user explicitly confirms the exact swap details.")
    }
  },
  async (input) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await requestPayBoxSolanaSwap(input), null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "PAYBOX_SWAP_REQUEST_FAILED";
      return { content: [{ type: "text", text: JSON.stringify({ error: code, executionEnabled: false, note: "No successful transaction was confirmed. Do not repeat the operation until its request status is reconciled." }, null, 2) }] };
    }
  }
);


server.registerTool(
  "paybox_request_transfer",
  {
    title: "Request a Solana transfer through PayBox",
    description: "REAL-FUNDS OPERATION. Sends SOL or an SPL token through the authenticated PayBox MCP session. Only call when the user explicitly asks for this exact transfer and confirms recipient, token, atomic amount, and wallet. Disabled unless VELTRION_PAYBOX_EXECUTION_ENABLED=true and PAYBOX_ACCESS_TOKEN is configured. PayBox's own wallet approval/signing flow remains authoritative. Never retry the same request; use paybox_request_status.",
    inputSchema: {
      credentialId: z.string().trim().min(1).max(200).describe("Granted PayBox wallet credential ID from paybox_list_wallets."),
      to: z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/).describe("Recipient Solana address."),
      token: z.string().min(1).max(44).optional().describe('SPL token mint; omit or use "native" for SOL.'),
      amount: z.string().regex(/^[1-9]\\d{0,39}$/).describe("Exact token atomic units (lamports for SOL)."),
      confirmed: z.literal(true).describe("Must be true only after the user explicitly confirms the exact transfer details.")
    }
  },
  async (input) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await requestPayBoxSolanaTransfer(input), null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "PAYBOX_TRANSFER_REQUEST_FAILED";
      return { content: [{ type: "text", text: JSON.stringify({ error: code, executionEnabled: false, note: "No successful transaction was confirmed. Do not repeat the operation until its request status is reconciled." }, null, 2) }] };
    }
  }
);


server.registerTool(
  "paybox_request_status",
  {
    title: "Reconcile an existing PayBox request",
    description: "Read the current status of a known PayBox request ID. Use this for pending approval/signature/confirmation/settlement. Never call the original swap or transfer again just to poll.",
    inputSchema: {
      requestId: z.string().trim().min(1).max(200).describe("The request_id returned by the original PayBox operation.")
    }
  },
  async ({ requestId }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await getPayBoxRequestStatus(requestId), null, 2) }] };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "PAYBOX_REQUEST_STATUS_FAILED";
      return { content: [{ type: "text", text: JSON.stringify({ error: code, note: "Request status is unknown. Do not submit a duplicate operation." }, null, 2) }] };
    }
  }
);


const transport = new StdioServerTransport();
await server.connect(transport);
