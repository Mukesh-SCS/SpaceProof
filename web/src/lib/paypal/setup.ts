export interface PayPalPublicSetup {
  ready: boolean;
  clientId: string | null;
  missing: string[];
}

const SERVER_KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const;
const PUBLIC_KEY = "NEXT_PUBLIC_PAYPAL_CLIENT_ID";

/** Returns names of missing settings and the public client id. Never returns the secret. */
export function describePayPalSetup(env: Record<string, string | undefined>): PayPalPublicSetup {
  const missing: string[] = [];
  for (const key of SERVER_KEYS) {
    if (!env[key]?.trim()) missing.push(key);
  }
  const clientId = env[PUBLIC_KEY]?.trim() ?? "";
  if (!clientId) missing.push(PUBLIC_KEY);
  if ((env.PAYPAL_ENVIRONMENT ?? "sandbox").trim() !== "sandbox") {
    missing.push("PAYPAL_ENVIRONMENT=sandbox");
  }
  return {
    ready: missing.length === 0,
    clientId: clientId || null,
    missing,
  };
}

export function paypalConfigurationMessage(missing: string[]): string {
  return [
    "PayPal Sandbox is not configured, so SpaceProof will not start a checkout.",
    `Missing: ${missing.join(", ")}.`,
    "Copy web/.env.example to web/.env, set the sandbox app credentials, and restart npm run dev.",
    "PAYPAL_CLIENT_SECRET stays on the server. Never prefix it with NEXT_PUBLIC_.",
  ].join(" ");
}
