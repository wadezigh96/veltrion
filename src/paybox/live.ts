import { PayboxClient } from "@paybox-sh/sdk";

export type PayBoxCredentialSummary = {
  id: string;
  name: string;
  kind: string;
};

export type PayBoxReadOnlySnapshot = {
  provider: "PayBox";
  connection: "authenticated" | "not-configured" | "error";
  transport: "official-sdk-rest";
  endpoint: "https://api.paybox.sh";
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

export function isCredentialListResponse(value: unknown): value is CredentialListShape & { credentials: NonNullable<CredentialListShape["credentials"]> } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as CredentialListShape).credentials));
}

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
 * Uses the official PayBox SDK's configured REST client for a read-only
 * credential listing. This is SDK/API integration, not a direct MCP session.
 * It never requests signatures or transactions.
 */
export async function loadPayBoxReadOnlySnapshot(): Promise<PayBoxReadOnlySnapshot> {
  try {
    const client = PayboxClient.fromConfig();
    const raw: unknown = await client.listCredentials();
    if (!isCredentialListResponse(raw)) {
      return {
        provider: "PayBox",
        connection: "error",
        transport: "official-sdk-rest",
        endpoint: "https://api.paybox.sh",
        grantedCredentialCount: 0,
        ungrantedCredentialCount: 0,
        credentials: [],
        walletAccess: false,
        executionEnabled: false,
        detail: "PayBox returned an unexpected credential-list response. Connection is not considered verified."
      };
    }

    const shape = raw as CredentialListShape;
    const credentials = summarizePayBoxCredentials(raw);
    return {
      provider: "PayBox",
      connection: "authenticated",
      transport: "official-sdk-rest",
      endpoint: "https://api.paybox.sh",
      grantedCredentialCount: credentials.length,
      ungrantedCredentialCount: Array.isArray(shape.ungranted) ? shape.ungranted.length : 0,
      credentials,
      walletAccess: false,
      executionEnabled: false,
      detail: "The official PayBox SDK returned a valid read-only credential listing. No transaction was requested."
    };
  } catch {
    // Do not return exception text: provider errors can contain sensitive request details.
    return {
      provider: "PayBox",
      connection: "error",
      transport: "official-sdk-rest",
      endpoint: "https://api.paybox.sh",
      grantedCredentialCount: 0,
      ungrantedCredentialCount: 0,
      credentials: [],
      walletAccess: false,
      executionEnabled: false,
      detail: "PayBox authentication or read-only request could not be verified. Use the official login flow locally and retry; no provider error details are exposed."
    };
  }
}
