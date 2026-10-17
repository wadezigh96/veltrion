# VELTRION

**Solana DeFi intelligence MCP agent with a guarded PayBox SDK integration path.**

VELTRION is a separate project for researching Solana DeFi opportunities, validating transaction intent, and—only after explicit user authorization—requesting supported wallet operations through PayBox.

## Project status

- [x] Initial repository and security-design review
- [x] Read-only-first architecture defined
- [x] Initial MCP server scaffold (`veltrion_status`, `defi_risk_check`)
- [x] Initial unit tests and security policy tests written
- [x] PayBox adapter boundary with mock-only and unconfigured fail-closed modes
- [x] GitHub Actions build and tests passed on commit `d910880` (direct PayBox MCP discovery, sanitized output, and amount edge-case tests included)
- [x] Official PayBox SDK dependency and read-only credential-status tool added (runtime authentication still needs user setup/verification)
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
PayBox SDK/API (OAuth + user-granted access; direct MCP client still pending)
   |
   v
User approval / PayBox signing and execution
   |
   v
Solana network -> verify final transaction status
```

VELTRION should not bypass PayBox by handling wallet private keys or broadcasting a transaction behind the user's back. Any future direct protocol integration must be reviewed independently and remain behind the same policy boundary.

## Planned MCP tools

### Initial read-only tools

- `veltrion_status` — report configuration and whether execution is disabled.
- `solana_wallet_portfolio` — show balances only through an explicitly authorized read source.
- `solana_token_inspect` — inspect a token mint and available metadata.
- `defi_opportunity_scan` — summarize supported, sourced opportunities with freshness and risk notes.
- `defi_risk_check` — validate a proposed action without signing or broadcasting.
- `paybox_readonly_status` — check the official SDK's local PayBox authentication and return sanitized credential metadata.
- `paybox_mcp_discover` — directly connect to PayBox MCP using local `PAYBOX_ACCESS_TOKEN` and list tool names/descriptions only; it never invokes discovered tools.
- `transaction_status` — inspect a known signature/request status.

### Future guarded actions (not enabled in the initial release)

- `swap_quote` — obtain and display a quote without treating it as authorization to trade.
- `swap_execute` — request a PayBox swap only after explicit confirmation and policy checks.
- `transfer_execute` — request a PayBox transfer only after explicit confirmation and recipient validation.

Tool availability must reflect actual implemented and tested functionality. Do not advertise an unimplemented tool as working.

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

The implementation stack has not yet been locked. Prefer a small, typed Node.js/TypeScript MCP service with a clear provider adapter boundary, deterministic tests, and no server-side private-key handling.

The legacy mock adapter still rejects swap requests. The official `@paybox-sh/sdk` provides a read-only credential listing over its REST client, and `paybox_mcp_discover` provides a separate direct MCP Streamable HTTP handshake plus `list_tools` discovery using a local `PAYBOX_ACCESS_TOKEN`. The direct MCP tool only discovers tool names/descriptions; it never invokes them. Neither tool enables swaps/transfers. This does not enable swaps or transfers in VELTRION; execution remains disabled pending verified request schemas, approval-flow tests, and explicit authorization. See [SECURITY.md](./SECURITY.md) and [docs/PAYBOX_DEFI_INTEGRATION.md](./docs/PAYBOX_DEFI_INTEGRATION.md).


## Local PayBox setup (read-only first)

1. Install dependencies: `npm install`.
2. On the same machine that runs this stdio MCP server, authenticate through the official PayBox SDK: `npx @paybox-sh/sdk login`.
3. Start VELTRION with `npm run dev` or build then use `npm start`.
4. Call `paybox_readonly_status` to verify the SDK can list granted credential metadata. For the direct MCP handshake, set `PAYBOX_ACCESS_TOKEN` in the local process environment through your supported PayBox OAuth setup, then call `paybox_mcp_discover`. The tool returns a sanitized allowlist and never returns access tokens or signing material.

Do not run `paybox connect` or configure a signing key just to test read-only access. Do not paste `PAYBOX_ACCESS_TOKEN` into chat, source files, MCP tool arguments, or GitHub issues. Do not paste credentials into chat or commit them. VELTRION's swap/transfer execution tools are intentionally not enabled yet.
