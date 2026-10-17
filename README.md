# VELTRION

**Solana DeFi intelligence MCP agent with read-only PayBox MCP discovery.**

VELTRION is a separate project for researching Solana DeFi opportunities, validating transaction intent, and—only after explicit user authorization—requesting supported wallet operations through PayBox.

## Project status

- [x] Initial repository and security-design review
- [x] Read-only-first architecture defined
- [x] MCP server tools for status, DeFi risk checks, PayBox discovery/wallet metadata, Solana mint inspection, live portfolio valuation, and transaction activity lookup
- [x] Read-only LLM agent via Vercel AI Gateway added on the feature branch; local live provider smoke test previously succeeded; provider/model availability can change
- [x] Initial unit tests and security policy tests written
- [x] PayBox adapter boundary with mock-only and unconfigured fail-closed modes
- [x] GitHub Actions build, tests, and production dependency audit passed on the latest verified feature-branch commit `4716fb1`
- [x] Direct PayBox MCP Streamable HTTP discovery tool added (live authentication and `list_tools` remain unverified until the documented OAuth token is supplied locally)
- [x] Removed the PayBox REST SDK after its transitive high-severity dependency issue; production dependency audit passed on the feature branch
- [ ] Solana mainnet execution review (disabled until explicitly approved)

This project has not been deployed and has not sent any transaction.

## Design principles

1. **PayBox owns wallet authorization.** VELTRION must never request, store, log, or expose seed phrases or raw wallet private keys.
2. **Read-only by default.** Portfolio, token metadata, quote inspection, risk checks, and transaction-status reads are the initial focus.
3. **Explicit execution boundary.** A swap or transfer is a separate action from analysis or quoting. Show chain, wallet, input/output assets, amount, slippage, fees, recipient (for transfers), and the relevant risks before requesting execution.
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
   |-- Quote and transaction-status presentation
   |
   v
PayBox MCP (OAuth access token supplied locally; tool discovery only)
   |
   v
User approval / PayBox signing and execution
   |
   v
Solana network -> verify final transaction status
```

VELTRION should not bypass PayBox by handling wallet private keys or broadcasting a transaction behind the user's back. Any future direct protocol integration must be reviewed independently and remain behind the same policy boundary.

## Implemented MCP tools

- `veltrion_status` — reports current configuration and confirms execution is disabled.
- `defi_risk_check` — validates a proposed action without signing or broadcasting.
- `solana_token_inspect` — reads a confirmed Solana mint account and reports token program, decimals, atomic supply, initialization, and authority flags.
- `solana_wallet_portfolio` — reads SOL balance, SPL/Token-2022 token-account balances, and a bounded recent signature history for a caller-supplied public address. No wallet connection or signing is required.
- `paybox_mcp_discover` — directly connects to PayBox MCP using local `PAYBOX_ACCESS_TOKEN` and lists tool names/descriptions only.
- `paybox_list_wallets` — invokes only PayBox's read-only `list_credentials` tool and returns allowlisted wallet metadata.

### Planned read-only tools

- `defi_opportunity_scan` — summarize supported, sourced opportunities with freshness and risk notes.
- `transaction_status` — inspect a known signature/request status. Detailed transaction decoding and protocol-specific farming position tracking remain future work.

### Future guarded actions (not enabled in the initial release)

- `swap_quote` — obtain and display a quote without treating it as authorization to trade.
- `swap_execute` — request a PayBox swap only after explicit confirmation and policy checks.
- `transfer_execute` — request a PayBox transfer only after explicit confirmation and recipient validation.

Tool availability must reflect actual implemented and tested functionality. Do not advertise an unimplemented tool as working.

## Read-only LLM agent (feature branch)

- `veltrion_llm_status` reports whether `AI_GATEWAY_API_KEY` and `VELTRION_LLM_MODEL` are configured; it does not call the provider.
- `veltrion_ai_agent` calls the Vercel AI Gateway Chat Completions endpoint and can select only three read-only tools: `solana_wallet_portfolio`, `solana_token_inspect`, and `defi_risk_check`.
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

The legacy mock adapter rejects swap requests. VELTRION now uses the official MCP client library to perform a direct Streamable HTTP handshake and `list_tools` discovery using a locally supplied `PAYBOX_ACCESS_TOKEN`. The discovery tool only lists sanitized tool names/descriptions; it never invokes provider tools. The PayBox REST SDK was deliberately removed after CI's production dependency audit found a high-severity transitive `ws` vulnerability with no available fix in that dependency chain. Swaps and transfers remain disabled. See [SECURITY.md](./SECURITY.md) and [docs/PAYBOX_DEFI_INTEGRATION.md](./docs/PAYBOX_DEFI_INTEGRATION.md).

## Local PayBox setup (read-only first)

1. Install dependencies: `npm install`.
2. The direct MCP adapter currently accepts an access token only through the local `PAYBOX_ACCESS_TOKEN` environment variable; it does not implement the OAuth browser/device-code flow or read the PayBox CLI's stored login. PayBox's CLI login can authenticate CLI commands, but it does not configure this direct MCP adapter. Until an approved token-provisioning flow is implemented, `paybox_mcp_discover` correctly returns `not-configured` when the variable is absent. Do not extract tokens from CLI configuration, print them, or commit them.
3. Start VELTRION with `npm run dev` or build then use `npm start`.
4. Call `paybox_mcp_discover` to verify the direct MCP handshake and list available tool names/descriptions. This does not call those tools or connect a wallet.

Do not paste `PAYBOX_ACCESS_TOKEN` into chat, source files, MCP tool arguments, or GitHub issues. Do not paste credentials into chat or commit them. VELTRION's swap/transfer execution tools are intentionally not enabled yet.

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
