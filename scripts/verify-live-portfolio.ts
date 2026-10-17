import { getSolanaWalletPortfolio } from "../src/solana/portfolio.js";

const address = process.env.VELTRION_PUBLIC_WALLET;
if (!address) {
  process.stderr.write("Set VELTRION_PUBLIC_WALLET to a public Solana address. Do not use a seed phrase or private key.\n");
  process.exitCode = 2;
} else {
  try {
    const portfolio = await getSolanaWalletPortfolio(address, 10);
    const summary = {
      network: portfolio.network,
      nativeBalance: portfolio.nativeBalance,
      tokenAccountCount: portfolio.tokenAccounts.length,
      pricedTokenAccounts: portfolio.valuation.pricedTokenAccounts,
      unpricedTokenAccounts: portfolio.valuation.unpricedTokenAccounts,
      estimatedTotalUsd: portfolio.valuation.totalUsd,
      recentActivityCount: portfolio.recentActivity.length,
      activityCategories: portfolio.recentActivity.map(item => ({
        category: item.category,
        classificationConfidence: item.classificationConfidence ?? "unavailable",
        detailsAvailable: item.detailsAvailable
      })),
      fetchedAt: portfolio.fetchedAt,
      sources: portfolio.source,
      executionEnabled: portfolio.executionEnabled
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    if (portfolio.tokenAccounts.length === 0 && portfolio.nativeBalance.lamports === "0" &&
        portfolio.recentActivity.length === 0) {
      process.stderr.write("Live RPC responded, but this address has no visible balance or recent activity.\n");
    }
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "LIVE_PORTFOLIO_CHECK_FAILED";
    process.stderr.write(JSON.stringify({ error: code, executionEnabled: false }) + "\n");
    process.exitCode = 1;
  }
}
