# VELTRION

**Solana DeFi intelligence MCP agent with read-only analysis and feature-gated PayBox transaction requests.**

VELTRION is a separate project for researching Solana DeFi opportunities, validating transaction intent, and—only after explicit user authorization—requesting supported wallet operations through PayBox.

## Project status

- [x] Initial repository and security-design review
- [x] Read-only-first architecture defined
- [x] MCP tools for portfolio/activity, native SOL staking monitor, public Solana yield scan, transaction status, token inspection, DeFi risk checks, and PayBox wallet discovery
- [x] Explicit PayBox Solana swap/transfer request tools and same-request status reconciliation; execution is disabled by default and not yet live-verified
- [x] Read-only LLM agent via Vercel AI Gateway added on the feature branch; local live provider smoke test previously succeeded; provider/model availability can change
- [x] Initial unit tests and security policy tests written
- [x] PayBox adapter boundary with mock-only and unconfigured fail-closed modes
- [x] GitHub Actions build, tests, and production dependency audit passed on the latest verified feature-branch commit `4716fb1`
- [x] Direct PayBox MCP Streamable HTTP discovery tool added (live authentication and `list_tools` remain unverified until the documented OAuth token is supplied locally)
- [x] Removed the PayBox REST SDK after its transitive high-severity dependency issue; production dependency audit passed on the feature branch
- [x] x402 V2 exact-USDC receiver for Base mainnet with standalone Node and Vercel serverless adapters; disabled by default and checks facilitator `/supported` before processing payments when enabled
- [x] x402 receiver unit tests for config validation, facilitator network support, and disabled HTTP behavior
- [ ] PayBox x402 send through VELTRION (blocked until a supported OAuth token-provisioning flow is configured; no credentials are extracted from the PayBox CLI config)
- [ ] Production x402 receive activation (requires the chosen receiving address, service price, Vercel project/domain and environment configuration, and live facilitator/settlement verification)
- [ ] Solana mainnet execution review (disabled until explicitly approved)

This project has not been deployed and has not sent any transaction.

## Design principles

1. **PayBox owns wallet authorization.** VELTRION must never request, store, log, or expose seed phrases or raw wallet private keys.
2. **Read-only by default.** Portfolio, token metadata, quote inspection, risk checks, and transaction-status reads are the initial focus.
3. **Explicit execution boundary.** A swap or transfer is a separate action from analysis or quoting. PayBox swap/transfer request tools exist behind `VELTRION_PAYBOX_EXECUTION_ENABLED=true`, require the user's exact confirmation flag, a granted Solana wallet, validated atomic amounts, and PayBox authorization. The AI analyst itself cannot call money-moving tools.
4. **No silent retries.** If a PayBox request is pending or its result is uncertain, poll the same request ID and reconcile its status. Never create a duplicate money operation to recover from a timeout.
5. **Mainnet guardrails.** No transaction should be submitted without the user's clear instruction and the applicable PayBox approval. Mainnet execution remains off until the tests and security review pass.
6. **Fail closed.** Reject malformed amounts, unsupported chains/tokens, invalid recipients, stale quotes, excessive slippage, and incomplete transaction details.
7. **No profit promises.** Yield and DeFi opportunity outputs must state data freshness, protocol/source, fees, and relevant risks; estimated APY is not a guarantee.
8. **Minimal secrets.** Credentials belong in the approved secret manager or local environment, never in source control, logs, tool output, or issue reports.

## Planned architecture

```text
MCP client
   |
   v
VELTRION MCP server
   |-- Read-only Solana market / token data
   |-- DeFi opportunity analysis and risk checks
   |-- Input validation and policy gate
   |-- Public yield scan and native staking monitor
   |-- Feature-gated swap / transfer request tools
   |-- Same-request status reconciliation
   |
   v
PayBox MCP (OAuth access token supplied locally; approved tools only)
   |
   v
User approval / PayBox signing and execution
   |
   v
Solana network -> verify final transaction status
```

VELTRION should not bypass PayBox by handling wallet private keys or broadcasting a transaction behind the user's back. Any future direct protocol integration must be reviewed independently and remain behind the same policy boundary.

## Implemented MCP tools

- `veltrion_status` — reports current configuration and the PayBox execution gate state.
- `defi_risk_check` — validates a proposed action without signing or broadcasting.
- `solana_token_inspect` — reads a confirmed Solana mint account and reports token program, decimals, atomic supply, initialization, and authority flags.\n- `solana_native_staking_monitor` — reads native Solana stake-program accounts for a public wallet and reports stake account SOL and activation state; does not cover liquid-staking tokens or third-party LP farming.\n- `solana_transaction_status` — checks the current status of a known Solana transaction signature; never submits or retries a transaction.\n- `defi_opportunity_scan` — scans public DefiLlama Solana yield/TVL data, filters by TVL, and flags APY outliers and relevant risk indicators; does not identify wallet deposits or claimable rewards.
- `solana_wallet_portfolio` — reads SOL balance, SPL/Token-2022 token-account balances, and a bounded recent signature history for a caller-supplied public address. No wallet connection or signing is required.
- `paybox_mcp_discover` — directly connects to PayBox MCP using local `PAYBOX_ACCESS_TOKEN` and lists tool names/descriptions only.
- `paybox_list_wallets` — invokes only PayBox's read-only `list_credentials` tool and returns allowlisted wallet metadata.

### Planned read-only tools

- Protocol-specific decoding of LP farming positions and claimable rewards. Current yield scanning is market-wide and native staking monitoring covers only native Solana stake accounts.

### Feature-gated PayBox actions

- `paybox_request_swap` — requests a same-chain Solana swap with exact source/destination token, atomic amount, slippage (maximum 300 bps), granted wallet, and `confirmed: true`.
- `paybox_request_transfer` — requests a Solana SOL/SPL transfer with a validated recipient, atomic amount, granted wallet, and `confirmed: true`.
- `paybox_request_status` — reconciles the same request ID; it never re-submits the operation.

These tools fail closed unless both `VELTRION_PAYBOX_EXECUTION_ENABLED=true` and `PAYBOX_ACCESS_TOKEN` are configured. They are separate MCP tools and are **not** exposed to the LLM's tool-calling allowlist. PayBox's own approval/signing flow is still authoritative. No live transaction has been tested.

Tool availability must reflect actual implemented and tested functionality. Do not advertise an unimplemented tool as working.

## Read-only LLM agent (feature branch)

- `veltrion_llm_status` reports whether `AI_GATEWAY_API_KEY` and `VELTRION_LLM_MODEL` are configured; it does not call the provider.
- `veltrion_ai_agent` calls the Vercel AI Gateway Chat Completions endpoint and can select only six read-only tools: `solana_wallet_portfolio`, `solana_token_inspect`, `defi_risk_check`, `defi_opportunity_scan`, `solana_native_staking_monitor`, and `solana_transaction_status`.
- The agent is bounded to at most three tool calls and two model requests per user message. It cannot call PayBox, pay x402 services, sign, or broadcast transactions.
- Configure `AI_GATEWAY_API_KEY` and `VELTRION_LLM_MODEL` in the local environment or deployment secret settings. Never commit real values. No default model is assumed.
- The API provider receives the user question and any tool results needed to answer it. Do not submit confidential information. API usage may incur charges under the provider account.
- GitHub Actions build, unit tests, and production dependency audit passed for the initial implementation. A local live smoke test was previously successful with a short request and no tools. CI does not make live LLM calls. Repeat the opt-in test only if credentials, model, or provider configuration changes; it may incur usage charges.

## Security and privacy

- Never ask the user to paste a seed phrase or private key.
- Never commit API tokens, OAuth tokens, signing material, wallet secrets, or populated `.env` files.
- Provide a sanitized `.env.example` only if configuration variables are needed.
- Do not log authorization headers, raw credentials, or sensitive wallet metadata.
- Use bounded timeouts and input limits; validate all external responses as untrusted data.
- Keep read operations separate from money-moving operations.
- Require the user to review the exact operation details before a real transaction.
- Treat timeouts and pending statuses as unknown—not as permission to retry.
- Verify the final request status and on-chain transaction before reporting success.

## Implementation gates

1. Write unit tests for input validation, risk policy, and pending-request reconciliation.
2. Implement read-only MCP tools with mocked data and test error paths.
3. Add PayBox integration behind an adapter, initially mocked.
4. Test approval, denial, timeout, stale quote, duplicate-request prevention, and malformed provider responses.
5. Review dependencies, secret handling, and deployment configuration.
6. Only then consider guarded mainnet actions, with explicit user approval. No deployment or live transaction is authorized by this plan.

## Development

The implementation uses a typed Node.js/TypeScript MCP service with a clear provider adapter boundary and no server-side private-key handling.

The legacy mock adapter rejects swap requests. VELTRION now uses the official MCP client library to perform a direct Streamable HTTP handshake and `list_tools` discovery using a locally supplied `PAYBOX_ACCESS_TOKEN`. The discovery tool only lists sanitized tool names/descriptions; it never invokes provider tools. The PayBox REST SDK was deliberately removed after CI's production dependency audit found a high-severity transitive `ws` vulnerability with no available fix in that dependency chain. Swap/transfer request tools are implemented but remain disabled by default. They have not been verified against the user's authenticated PayBox session, so do not enable them in production until a local low-value test, request-status reconciliation test, and security review pass. Stake deposits, unstaking, and yield-farming deposits are not implemented. Read-only native staking and public yield scanning are available on the feature branch. See [SECURITY.md](./SECURITY.md) and [docs/PAYBOX_DEFI_INTEGRATION.md](./docs/PAYBOX_DEFI_INTEGRATION.md).

## Local PayBox setup (read-only first)

1. Install dependencies: `npm install`.
2. The direct MCP adapter currently accepts an access token only through the local `PAYBOX_ACCESS_TOKEN` environment variable; it does not implement the OAuth browser/device-code flow or read the PayBox CLI's stored login. PayBox's CLI login can authenticate CLI commands, but it does not configure this direct MCP adapter. Until an approved token-provisioning flow is implemented, `paybox_mcp_discover` correctly returns `not-configured` when the variable is absent. Do not extract tokens from CLI configuration, print them, or commit them.
3. Start VELTRION with `npm run dev` or build then use `npm start`.
4. Call `paybox_mcp_discover` to verify the direct MCP handshake and list available tool names/descriptions. This does not call those tools or connect a wallet.
5. Keep `VELTRION_PAYBOX_EXECUTION_ENABLED` unset or `false` until you have reviewed the tools and verified a granted wallet. Enabling the flag can allow real Solana swaps/transfers from a granted wallet; never enable it just to test discovery.

Do not paste `PAYBOX_ACCESS_TOKEN` into chat, source files, MCP tool arguments, or GitHub issues. Do not commit credentials. Execution is disabled by default; enabling it is a deliberate production security decision.

## Verify live portfolio data (no mock)

Run a real read-only lookup against Solana mainnet RPC and DexScreener using a public wallet address you control. The address is read from a local environment variable and is not written to source code. Do not use a seed phrase or private key.

```bash
VELTRION_PUBLIC_WALLET='YOUR_PUBLIC_SOLANA_ADDRESS' npm run verify:portfolio:live
```

This command prints a sanitized summary only. It does not sign, pay, or submit transactions. Token prices are estimates; unsupported or illiquid assets may be unpriced, and activity categories are heuristics rather than authoritative protocol decoding.


## Verify live LLM connectivity (opt-in; may incur usage charges)

This performs one short request to Vercel AI Gateway. It does not use wallet tools, read wallet data, pay, sign, or submit a transaction. Use a model ID shown in the current AI Gateway model catalog; model IDs can change over time.

From the repository directory, enter the key silently so it is not echoed, then run the explicitly opt-in smoke test:

```bash
read -r -s -p "AI Gateway API key: " AI_GATEWAY_API_KEY; echo
export AI_GATEWAY_API_KEY
read -r -p "Model ID from the current AI Gateway catalog: " VELTRION_LLM_MODEL
export VELTRION_LLM_MODEL
export VELTRION_ALLOW_LIVE_LLM_TEST=1
npm run verify:llm:live
```

These variables exist only in the current shell session. Do not paste the key into chat, put it in source code, or commit it. If the smoke test succeeds, the MCP server can use the same environment variables when it is launched from that shell. To stop retaining the variables in that session, run `unset AI_GATEWAY_API_KEY VELTRION_LLM_MODEL VELTRION_ALLOW_LIVE_LLM_TEST`.


## x402 send and receive

See [docs/X402_SEND_RECEIVE.md](docs/X402_SEND_RECEIVE.md) for the guarded receiver, configuration requirements, and current PayBox send integration limitation. The receiver is disabled by default and currently serves demo content only; this repository has not been deployed and no payment has been sent.
