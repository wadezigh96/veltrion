# VELTRION DeFi and PayBox Integration

## Current scope

VELTRION is a Solana-first DeFi intelligence MCP server. It separates public/read-only research from money-moving operations.

Implemented on the feature branch:

- Public Solana wallet portfolio, token metadata, and recent activity.
- Native Solana stake-account monitor (only native stake-program accounts).
- Public Solana yield opportunity scan from DefiLlama, with TVL filtering and APY/risk flags.
- Read-only Solana transaction-signature status lookup.
- PayBox MCP discovery and granted wallet metadata.
- Feature-gated PayBox Solana swap and transfer requests, plus same-request status reconciliation.
- A Vercel AI Gateway analyst whose tool-calling allowlist contains read-only tools only.

Not implemented: stake/unstake transaction builders, third-party LP farming deposits/withdrawals, protocol-specific LP position decoding, and claimable-reward decoding. The yield scan is market-wide; it does not claim that a wallet owns any listed pool.

## Authentication and secrets

- Direct MCP endpoint: `https://api.paybox.sh/mcp`.
- The adapter accepts `PAYBOX_ACCESS_TOKEN` only from the local process environment or an approved secret manager. It does not read or extract PayBox CLI login state and does not implement an OAuth browser/PKCE flow.
- Never commit a real token or paste it into chat, source code, logs, tool arguments, or GitHub issues.
- PayBox remains responsible for wallet authorization, signing, broadcasting, and its own passkey/approval flow. VELTRION never asks for or stores seed phrases or raw private keys.

## Money-moving tools

The following MCP tools are implemented but disabled by default:

- `paybox_request_swap`: same-chain Solana swap through PayBox. Amount is an integer string in the source token's atomic units. Source/destination token must be `native` or a base58 token mint. Slippage is limited to 0–300 bps.
- `paybox_request_transfer`: SOL or SPL transfer through PayBox. Amount is an integer string in lamports/token atomic units. Recipient is validated as a base58 Solana address.
- `paybox_request_status`: reads the current state of the original PayBox `request_id`; it does not submit a new operation.

Both transaction request tools require:

1. `VELTRION_PAYBOX_EXECUTION_ENABLED=true`.
2. A valid `PAYBOX_ACCESS_TOKEN` obtained through a supported PayBox authorization flow.
3. A credential ID returned by VELTRION's read-only `paybox_list_wallets`, for a granted wallet whose chain metadata includes Solana.
4. `confirmed: true` only after the user explicitly confirms the exact wallet, token, amount, recipient (for transfers), and slippage (for swaps).

**Keep the feature flag unset or false by default.** Enabling it can initiate real money movement from a granted wallet. This feature has not yet been live-tested against the user's authenticated PayBox account; do not enable it in production until the user has reviewed the code and completed a controlled low-value test.

The LLM analyst does not have these money-moving tools in its own tool-calling allowlist. It can analyze, scan opportunities, inspect native stake accounts, and check transaction status; it cannot decide to execute a swap or transfer on its own.

## Request lifecycle and retry safety

1. Read the user's public portfolio and the relevant token/protocol data.
2. Validate exact token addresses, atomic amount, wallet grant, slippage, and recipient.
3. Ask the user to confirm the exact operation in the client before calling a money-moving tool.
4. PayBox receives the request and applies its configured authorization/signing policy.
5. If the response is pending or uncertain, call `paybox_request_status` with the **same** `request_id`.
6. Never submit the original swap/transfer again to recover from a timeout or pending status.
7. Check the returned PayBox status and, when a Solana signature is available, use `solana_transaction_status` to verify the on-chain state before claiming success.

A pending request, a successful request submission, or an API timeout is not by itself proof of a successful on-chain operation.

## Staking and farming scope

- `solana_native_staking_monitor` looks for native Solana stake-program accounts where the supplied public wallet is the staker or withdrawer, then checks activation state.
- `defi_opportunity_scan` scans public yield/TVL data for Solana pools and flags APY outliers, low TVL, impermanent-loss indicators, and variable reward APY.
- Neither tool supports liquid-staking token positions, third-party LP-farming deposits, protocol-specific reward claims, or stake/farm execution. Those require a protocol-specific adapter and reviewed transaction construction, withdrawal path, and risk tests. Do not infer a user's deposit from the opportunity list.

## Data and risk limits

- DefiLlama APY/TVL is third-party public data, not a guarantee or executable quote. Data may be delayed or incomplete. Very high APY is flagged as an outlier rather than automatically treated as best.
- Wallet portfolio USD values use public market-pair estimates; low-liquidity or unsupported tokens may remain unpriced.
- Transaction activity categories are heuristics unless protocol-specific decoding is implemented.
- RPC/API failures fail closed. The code does not silently retry a money-moving request.
- No seed phrase/private key is requested or stored.

## Verification status

- Unit tests cover public yield-data normalization, APY outlier handling, input validation, and the default-disabled PayBox execution gate.
- GitHub Actions build, tests, and production dependency audit are the required CI gate for the feature branch.
- Live PayBox OAuth authentication, wallet grant discovery, request approval, transfer/swap settlement, and on-chain reconciliation have not yet been verified in this session.
- No live swap, transfer, stake, farm deposit, x402 payment, or deployment has been performed by this implementation.
