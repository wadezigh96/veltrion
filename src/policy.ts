export type RiskCheckInput = {
  chain: string;
  action: "swap" | "transfer" | "stake" | "lend";
  amount: string;
  slippageBps?: number;
  quoteAgeSeconds?: number;
  recipient?: string;
  tokenMint?: string;
};

export type RiskCheckResult = {
  allowedForReview: boolean;
  executionEnabled: false;
  reasons: string[];
};

const SOLANA_MAINNET = "solana:mainnet";
const MAX_SLIPPAGE_BPS = 300;
const MAX_QUOTE_AGE_SECONDS = 60;
const BASE58_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function checkDefiRequest(input: RiskCheckInput): RiskCheckResult {
  const reasons: string[] = [];

  if (input.chain !== SOLANA_MAINNET) {
    reasons.push("Unsupported chain: this initial policy only accepts solana:mainnet.");
  }

  if (!POSITIVE_DECIMAL.test(input.amount) || Number(input.amount) <= 0 || !Number.isFinite(Number(input.amount))) {
    reasons.push("Amount must be a positive decimal string.");
  }

  if (input.action === "swap") {
    if (input.slippageBps === undefined || !Number.isInteger(input.slippageBps) ||
        input.slippageBps < 0 || input.slippageBps > MAX_SLIPPAGE_BPS) {
      reasons.push(`Swap slippage must be an integer between 0 and ${MAX_SLIPPAGE_BPS} basis points.`);
    }

    if (input.quoteAgeSeconds === undefined || !Number.isInteger(input.quoteAgeSeconds) ||
        input.quoteAgeSeconds < 0 || input.quoteAgeSeconds > MAX_QUOTE_AGE_SECONDS) {
      reasons.push(`Swap quote must be no more than ${MAX_QUOTE_AGE_SECONDS} seconds old.`);
    }

    if (!input.tokenMint || !BASE58_PUBLIC_KEY.test(input.tokenMint)) {
      reasons.push("A valid-looking base58 token mint is required for a swap.");
    }
  }

  if (input.action === "transfer") {
    if (!input.recipient || !BASE58_PUBLIC_KEY.test(input.recipient)) {
      reasons.push("A valid-looking base58 recipient is required for a transfer.");
    }
  }

  if (input.action === "stake" || input.action === "lend") {
    reasons.push("Staking and lending are not enabled until a specific protocol adapter is reviewed and tested.");
  }

  return {
    allowedForReview: reasons.length === 0,
    executionEnabled: false,
    reasons
  };
}
