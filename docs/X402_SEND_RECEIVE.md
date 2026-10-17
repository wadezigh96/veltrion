# VELTRION x402 send / receive status

## Receive endpoint (implemented, disabled by default)

A standalone Node HTTP service implements a deliberately narrow x402 V2 **exact USDC on Base mainnet** receiver. It exposes:

- `GET /health` — reports configuration only.
- `GET /api/paid/summary` — emits an x402 V2 `402 Payment Required` challenge until a valid `PAYMENT-SIGNATURE` is supplied; verifies with the configured facilitator, settles the same payload, and only releases the resource after settlement succeeds.
- Unknown paths return 404. The resource body is demo content, not a production market-data feed.

It fails closed if configuration is invalid, the payment requirements differ, the facilitator is unavailable, or settlement is uncertain. If settlement is pending/unknown, it does not disclose the paid resource and tells the caller to reconcile the same payment rather than pay again.

### Required environment

Set these values in the host's secret/environment settings, never in Git:

- `X402_RECEIVE_ENABLED=true` — explicit opt-in. Default false.
- `X402_RECEIVE_PAY_TO=0x...` — your chosen Base mainnet receiving address. Do not copy a wallet address without deciding it is the intended receiver.
- `X402_RECEIVE_PRICE_USDC=0.01` — decimal USDC price, up to six decimal places.
- `X402_FACILITATOR_URL=https://facilitator.payai.network/` — optional; defaults to the PayAI facilitator. At startup, when enabled, VELTRION checks `/supported` and refuses to start unless the facilitator advertises x402 V2 exact on `eip155:8453`. VELTRION appends `verify` and `settle`.
- `X402_PUBLIC_URL=https://YOUR-DEPLOYED-HOST/` — public HTTPS origin of this receiver.
- Optional `X402_RECEIVE_HOST=127.0.0.1` and `X402_RECEIVE_PORT=8787`.

Start locally with `npm run x402:serve`. The default bind address is loopback. For public hosting, bind to the host's required interface and deploy this process behind HTTPS. This standalone listener is not automatically served by the existing stdio MCP process and is not a Vercel serverless route. Do not set `X402_RECEIVE_ENABLED=true` until the receiving address, price, facilitator support, deployment, and live conformance checks are verified.

## Send x402 (PayBox)

The repository currently has read-only Bazaar discovery and an unpaid x402 challenge preview. Real sending is **not enabled inside VELTRION yet**: direct PayBox MCP needs an approved local `PAYBOX_ACCESS_TOKEN` provisioning flow, and the CLI's saved OAuth session is not interchangeable with that token. Never extract the token from CLI files or print it.

For a real paid call, use PayBox's approved x402 workflow, review the resource URL and exact accepted requirements, choose the intended granted wallet, and set an explicit spending ceiling before authorizing. Follow the returned `request_id` to a terminal result; do not repeat the payment tool to recover from a timeout. A probe is unpaid and does not prove a paid request works.

## Safety and protocol notes

- Only Base mainnet USDC exact payments are advertised. The receiver rejects other networks, assets, schemes, amount, or recipient.
- The receiver uses facilitator `/verify` before processing and `/settle` before disclosing the resource. The facilitator must support the exact network/scheme.
- Never use a development-only facilitator for mainnet without verifying its production suitability.
- No credentials, wallet keys, or payment payloads are logged.
- No real payment was sent by adding this code.
- This endpoint is a scaffold with a demo resource; successful CI is not proof of a production deployment or live settlement.
