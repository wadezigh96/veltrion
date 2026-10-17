# Security Policy and Threat Model

## Scope

VELTRION is a Solana DeFi intelligence MCP agent. PayBox is the intended wallet authorization and transaction execution boundary. This document is an initial design policy, not an independent security audit or a claim that the implementation is already secure.

## Assets to protect

- Wallet assets and transaction authority
- PayBox client credentials, OAuth tokens, and any other secrets
- User privacy and wallet-linked metadata
- Transaction intent (chain, token mints, amount, destination, slippage, fees)
- Integrity of market data, quotes, and final transaction status

## Threats and required controls

| Threat | Required control |
| --- | --- |
| Prompt injection or malicious token metadata | Treat tool results, token metadata, web content, and protocol descriptions as untrusted data; never let them override execution policy. |
| Accidental or duplicate transaction | Separate quote from execution; persist/reconcile the original PayBox request ID; poll pending operations rather than resubmitting. |
| Wrong token or recipient | Validate Solana public-key formats, token mint, chain, amount units, and destination; display exact details for confirmation. |
| Stale quote or expired blockhash | Reject stale quote data and obtain a fresh quote when appropriate; never silently execute using expired transaction data. |
| Excessive slippage or hidden costs | Apply configurable maximum slippage and show estimated fees, price impact, and output amount when supplied by a trusted quote source. |
| Secret leakage | Keep secrets out of source control, logs, errors, prompts, and tool responses. Use approved secret storage and least privilege. |
| Provider outage or ambiguous result | Fail closed, use bounded retries only for safe reads, and reconcile money-moving operations by their original request ID. |
| Misleading success report | Report success only after PayBox's terminal success result and the relevant on-chain confirmation are verified. |
| Unsafe autonomous execution | Keep execution disabled by default; require clear user intent and PayBox's configured approval policy. |

## Transaction policy

Before any future live swap or transfer, VELTRION must:

1. Confirm the user explicitly requested the specific action.
2. Confirm the network is Solana mainnet only if the user requested mainnet.
3. Validate token mint, amount and units, destination where applicable, slippage, quote freshness, and fee information.
4. Present the exact proposed operation and material risks for user review.
5. Submit no more than one PayBox request for that operation.
6. If status is pending or uncertain, poll the same request ID. Do not submit a replacement request.
7. Report the actual terminal outcome and verify the transaction signature/status where available.

An approval applies only to the exact operation submitted. Any change to amount, token, destination, or other material parameters requires a new confirmation.

## Initial release restrictions

- No seed phrase or raw private key input.
- No locally stored wallet private key.
- No direct transaction broadcast from VELTRION.
- No automatic trading, copy trading, or unattended rebalancing.
- No mainnet transaction until tests and a separate explicit authorization.
- No claim that lending, staking, or yield farming is supported until a specific protocol integration is implemented, tested, and its risks documented.

## Minimum test checklist

- [ ] Invalid public key, mint, amount, decimal precision, and destination are rejected.
- [ ] Unsupported chain and token are rejected.
- [ ] Slippage above the configured ceiling is rejected.
- [ ] Stale quote is rejected or requires a fresh quote.
- [ ] Analysis and quote tools cannot call execution.
- [ ] Execution remains disabled when configuration is missing or invalid.
- [ ] User denial never triggers an alternate transaction.
- [ ] Pending request polls the same request ID.
- [ ] Timeout or lost response does not create a duplicate operation.
- [ ] Provider errors and malformed responses fail closed.
- [ ] Logs and errors redact credentials and authorization headers.
- [ ] Success is not reported for a signature alone or a non-terminal request.

## Incident response

If credentials may have leaked, revoke the affected PayBox agent/client grant and credentials through PayBox, rotate any affected secrets, inspect audit events, and stop live operations until the incident is reviewed. Never paste credentials into a GitHub issue or chat transcript.

## Reporting

Do not publish exploitable details or real credentials in public issues. Remove secrets from the source and revoke/rotate them immediately; deleting a committed secret does not make it safe again.
