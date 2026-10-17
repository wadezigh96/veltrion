# Direct PayBox MCP Integration for Solana DeFi

## Objective

VELTRION currently acts as a Solana DeFi intelligence MCP server and includes a direct PayBox MCP Streamable HTTP discovery client. It only performs a handshake and `list_tools`; it does not invoke provider tools. PayBox remains the wallet authorization, signing, and supported transaction execution boundary.

**Important:** a direct MCP connection requires an authenticated PayBox MCP session (OAuth 2.1). A URL alone is not authentication. Never hardcode or commit access tokens. Until the OAuth/client flow is implemented and tested, the integration must use a mock adapter and must not claim to be connected.

## Responsibilities

### VELTRION

- Read and explain portfolio / token / market information from configured trusted sources.
- Inspect proposed DeFi actions and reject invalid or unsafe requests.
- Display chain, wallet, token mint, amount and units, expected output, slippage, fees, price impact, quote freshness, and material risks when those details are available.
- Keep analysis and quote requests separate from transaction execution.
- Track the status of a single PayBox request and verify its final result.
- State clearly when data is unavailable or stale; never invent quotes, balances, yields, or execution status.

### PayBox MCP

Use only tools exposed by the authenticated PayBox MCP session and permitted by the user's granted credentials. PayBox is the boundary for wallet authorization, signing, and supported transfers/swaps. VELTRION must not ask for or store seed phrases or raw private keys, and must not bypass PayBox to broadcast transactions.

## Supported feature map (must be verified at runtime)

| Feature | Initial approach | Safety condition |
| --- | --- | --- |
| Wallet portfolio / balances | Read-only PayBox tool or trusted Solana read provider | Only use wallets the user has authorized; label data source and freshness |
| Token inspection | Read-only metadata / mint inspection | Validate mint; treat token metadata as untrusted |
| Swap quote | PayBox swap intent/quote tool, if exposed | Quote is not permission to execute; enforce slippage and freshness |
| Swap execution | PayBox swap request, if exposed | Explicit user confirmation of exact parameters; poll the same request ID |
| SOL/SPL transfer | PayBox transfer request, if exposed | Separate explicit confirmation; validate recipient, mint, and atomic units |
| Staking / lending / yield farming | Separate protocol adapter only after review | Do not claim support until specific protocol actions are implemented and tested |
| Transaction verification | PayBox request status and/or Solana signature confirmation | Report success only when terminal status and confirmation are verified |

Tool names and exact input schemas must be discovered from the live authorized MCP server. Do not assume a tool exists based only on this plan.

## Direct PayBox MCP status

- Implemented: direct MCP Streamable HTTP transport to `https://api.paybox.sh/mcp`, using a local `PAYBOX_ACCESS_TOKEN` bearer token, exposed as `paybox_mcp_discover`.
- Implemented: `paybox_list_wallets` calls only the read-only `list_credentials` provider tool and returns an allowlist of wallet credential ID, display name, approval mode, address, and chain names. Card, secret, ungranted, and raw provider data are excluded.
- This tool performs only the MCP handshake and `list_tools` discovery. It returns a bounded list of tool names and descriptions, and never calls the discovered tools.
- Not implemented: an in-app OAuth 2.1 authorization-code/PKCE flow. The token must be provisioned locally using PayBox's supported flow; VELTRION does not request or store it.
- No live authenticated account has been tested in this development session.
- The `@paybox-sh/sdk` REST package was removed after the production dependency audit identified a high-severity transitive `ws` vulnerability with no fix available in the current `viem` dependency chain. Prefer the direct MCP path while that dependency issue remains unresolved.

## MCP connection design

- PayBox MCP endpoint documented by PayBox: `https://api.paybox.sh/mcp`.
- Authentication: OAuth 2.1 and explicit user-granted access; configure through the supported PayBox/client flow.
- Do not invent a bearer token, OAuth callback, client ID, or unsupported authentication flow.
- Keep PayBox access tokens outside Git and redact authorization headers from logs.
- Use a narrow adapter interface so tests can use a deterministic mock and production can use the authenticated PayBox MCP client.
- Apply timeouts to safe read calls. For money-moving requests, timeout means **unknown status**, not failure; query the same request ID instead of submitting again.

## Transaction lifecycle

1. User requests a specific action.
2. VELTRION validates the action and obtains current quote/details.
3. VELTRION presents the exact operation and risks.
4. User explicitly confirms the exact operation.
5. VELTRION requests the corresponding PayBox operation through the authenticated session.
6. If PayBox reports pending approval/signature/confirmation/settlement, poll the same request ID.
7. Verify terminal status and chain confirmation where available.
8. Report the actual outcome, signature, fees, and remaining uncertainty. Never report success based on request submission alone.

Any material change in token, amount, recipient, chain, or slippage requires a new confirmation.

## Implementation stages

1. **Mock-first foundation:** define typed provider interfaces and deterministic unit tests. No wallet access or network transaction.
2. **Read-only integration:** connect to PayBox only through supported OAuth flow; verify wallet grants and portfolio/status reads.
3. **Quote integration:** validate quote freshness, amounts, slippage, fee fields, and unsupported routes.
4. **Guarded swap integration:** disabled by default until the tests and review pass; require explicit per-operation approval.
5. **Protocol-specific DeFi:** consider staking/lending only after selecting a concrete Solana protocol and reviewing its program, account requirements, risks, and exit path.
6. **Mainnet authorization:** a separate deliberate user decision. This plan itself does not authorize a deployment or transaction.

## Minimum tests

- Missing/invalid PayBox auth fails closed without leaking credentials.
- No private key or seed phrase is requested or logged.
- Analysis/quote cannot trigger execution.
- Invalid mint, amount, decimal precision, slippage, and recipient are rejected.
- Stale quotes cannot be executed.
- User denial does not trigger a fallback transaction.
- Pending operations poll the same request ID; duplicate requests are prevented.
- Timeouts and malformed responses never become false success.
- Provider errors and unsupported routes fail closed.
- All logs redact OAuth tokens and authorization headers.
- No real PayBox request is sent by unit tests.

## Current status

The repository uses the MCP SDK to connect directly to PayBox MCP and discover tools. It does not invoke any discovered provider tool. Build, unit tests, and production dependency audit passed on commit `8b01421` after removing the PayBox REST SDK dependency.

This is a direct MCP discovery path, but it is **not yet verified against the user's authenticated PayBox account**. The former PayBox REST SDK was removed after the production audit found a high-severity transitive `ws` vulnerability with no fix available in that dependency chain. The production audit passed after removal. Runtime authentication against the user's PayBox account is still unverified. No swap/transfer execution tool is exposed by VELTRION yet. The discovered PayBox tool catalogue is informational only and cannot trigger a provider operation. Before adding one, verify the exact SDK request/response schema and Solana chain support, then test user approval, denied/pending outcomes, timeout reconciliation using the same request ID, duplicate prevention, and on-chain status verification. Mainnet execution remains disabled.
