import { PayboxClient } from "@paybox-sh/sdk";

export type PayBoxCredentialSummary = {
  id: string;
  name: string;
  kind: string;
};

export type PayBoxReadOnlySnapshot = {
  provider: "PayBox";
  connection: "authenticated" | "not-configured" | "error";
  endpoint: "https://api.paybox.sh/mcp";
  grantedCredentialCount: number;
  ungrantedCredentialCount: number;
  credentials: PayBoxCredentialSummary[];
  walletAccess: false;
  executionEnabled: false;
  detail: string;
};

type CredentialListShape = {
  credentials?: Array<{
    name?: unknown;
    kind?: unknown;
    credential?: { id?: unknown };
  }>;
  ungranted?: Array<unknown>;
};

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 100);
}

/** Pure sanitizer: never returns tokens, keys, raw credential objects, or provider payloads. */
export function summarizePayBoxCredentials(value: unknown): PayBoxCredentialSummary[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as CredentialListShape).credentials;
  if (!Array.isArray(rows)) return [];

  return rows.slice(0, 50).map((row, index) => ({
    id: safeLabel(row?.credential?.id, `unknown-${index + 1}`),
    name: safeLabel(row?.name, "Unnamed credential"),
    kind: safeLabel(row?.kind, "unknown")
  }));
}

/**
 * Uses the official PayBox SDK's existing local OAuth/API configuration.
 * It only lists credential metadata; it does not request a signature or transaction.
 */
export async function loadPayBoxReadOnlySnapshot(): Promise<PayBoxReadOnlySnapshot> {
  try {
    const client = PayboxClient.fromConfig();
    const raw: unknown = await client.listCredentials();
    const shape = raw && typeof raw === "object" ? raw as CredentialListShape : {};
    const credentials = summarizePayBoxCredentials(raw);

    return {
      provider: "PayBox",
      connection: "authenticated",
      endpoint: "https://api.paybox.sh/mcp",
      grantedCredentialCount: credentials.length,
      ungrantedCredentialCount: Array.isArray(shape.ungranted) ? shape.ungranted.length : 0,
      credentials,
      walletAccess: false,
      executionEnabled: false,
      detail: "PayBox SDK responded to a read-only credential listing. No transaction was requested."
    };
  } catch {
    // Do not return exception text: provider errors can contain sensitive request details.
    return {
      provider: "PayBox",
      connection: "not-configured",
      endpoint: "https://api.paybox.sh/mcp",
      grantedCredentialCount: 0,
      ungrantedCredentialCount: 0,
      credentials: [],
      walletAccess: false,
      executionEnabled: false,
      detail: "PayBox is not authenticated or the read-only check failed. Run the official PayBox login flow locally, then retry."
    };
  }
}
