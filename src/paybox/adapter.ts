export type PayBoxConnectionState =
  | "mock-only"
  | "not-configured"
  | "authenticated"
  | "error";

export type PayBoxStatus = {
  provider: "PayBox";
  endpoint: "https://api.paybox.sh/mcp";
  connection: PayBoxConnectionState;
  walletAccess: false;
  executionEnabled: false;
  detail: string;
};

export type SwapIntent = {
  chain: "solana:mainnet";
  inputToken: string;
  outputToken: string;
  amountAtomic: string;
  slippageBps: number;
};

export interface PayBoxAdapter {
  status(): PayBoxStatus;
  requestSwap(_intent: SwapIntent): Promise<never>;
}

/**
 * Safe placeholder for development and tests.
 *
 * This adapter does not connect to PayBox, read credentials, access a wallet,
 * sign transactions, or broadcast. Live MCP/OAuth integration must be added
 * only after the supported client/auth flow and tool schemas are verified.
 */
export class MockPayBoxAdapter implements PayBoxAdapter {
  status(): PayBoxStatus {
    return {
      provider: "PayBox",
      endpoint: "https://api.paybox.sh/mcp",
      connection: "mock-only",
      walletAccess: false,
      executionEnabled: false,
      detail: "Mock adapter only. No PayBox session or wallet is connected."
    };
  }

  async requestSwap(_intent: SwapIntent): Promise<never> {
    throw new Error("PAYBOX_LIVE_INTEGRATION_DISABLED: no swap request was sent.");
  }
}

/** Production must remain unavailable until an authenticated adapter is implemented. */
export class UnconfiguredPayBoxAdapter implements PayBoxAdapter {
  status(): PayBoxStatus {
    return {
      provider: "PayBox",
      endpoint: "https://api.paybox.sh/mcp",
      connection: "not-configured",
      walletAccess: false,
      executionEnabled: false,
      detail: "PayBox OAuth/MCP client is not configured."
    };
  }

  async requestSwap(_intent: SwapIntent): Promise<never> {
    throw new Error("PAYBOX_NOT_CONFIGURED: execution is disabled and no request was sent.");
  }
}
