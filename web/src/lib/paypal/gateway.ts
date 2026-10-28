import {
  readPayPalAuthorization,
  readPayPalCapture,
  readPayPalOrder,
  type PayPalOrderSnapshot,
} from "@/lib/paypal/snapshot";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export class PayPalConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super("PayPal sandbox credentials are not configured.");
    this.name = "PayPalConfigError";
    this.missing = missing;
  }
}

export class PayPalRequestError extends Error {
  readonly httpStatus: number;
  readonly issue?: string;
  readonly debugId?: string;

  constructor(message: string, httpStatus: number, issue?: string, debugId?: string) {
    super(message);
    this.name = "PayPalRequestError";
    this.httpStatus = httpStatus;
    this.issue = issue;
    this.debugId = debugId;
  }
}

export interface CreatePayPalOrderInput {
  requestId: string;
  amountValue: string;
  currency: string;
  sku: string;
  description: string;
  customId: string;
}

export interface PayPalGateway {
  createOrder(input: CreatePayPalOrderInput): Promise<PayPalOrderSnapshot>;
  authorizeOrder(input: { orderId: string; requestId: string }): Promise<PayPalOrderSnapshot>;
  captureAuthorization(input: { authorizationId: string; requestId: string }): Promise<PayPalOrderSnapshot>;
  voidAuthorization(input: { authorizationId: string; requestId: string }): Promise<PayPalOrderSnapshot>;
  getOrder(orderId: string): Promise<PayPalOrderSnapshot>;
  getAuthorization(authorizationId: string): Promise<PayPalOrderSnapshot>;
  getCapture(captureId: string): Promise<PayPalOrderSnapshot>;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

function requiredEnv(env: Record<string, string | undefined>): { clientId: string; clientSecret: string } {
  const clientId = env.PAYPAL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() ?? "";
  const environment = (env.PAYPAL_ENVIRONMENT ?? "sandbox").trim();
  const missing: string[] = [];
  if (!clientId) missing.push("PAYPAL_CLIENT_ID");
  if (!clientSecret) missing.push("PAYPAL_CLIENT_SECRET");
  if (environment !== "sandbox") missing.push("PAYPAL_ENVIRONMENT=sandbox");
  if (missing.length > 0) throw new PayPalConfigError(missing);
  return { clientId, clientSecret };
}

async function readError(response: Response): Promise<PayPalRequestError> {
  const text = await response.text();
  let issue: string | undefined;
  let debugId: string | undefined;
  let message = `PayPal returned HTTP ${response.status}.`;
  try {
    const body = JSON.parse(text) as {
      message?: string;
      debug_id?: string;
      name?: string;
      details?: Array<{ issue?: string; description?: string }>;
    };
    debugId = body.debug_id;
    issue = body.details?.[0]?.issue ?? body.name;
    const description = body.details?.[0]?.description ?? body.message;
    if (description) message = description;
  } catch {
    if (text.trim()) message = text.trim().slice(0, 300);
  }
  return new PayPalRequestError(message, response.status, issue, debugId);
}

/**
 * Merchant Orders v2 and Payments v2 client for the PayPal sandbox.
 * Create and authorize: https://developer.paypal.com/docs/api/orders/v2/
 * Capture and void: https://developer.paypal.com/docs/api/payments/v2/
 */
export function createPayPalGateway(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): PayPalGateway {
  let cache: TokenCache | null = null;

  async function accessToken(): Promise<string> {
    if (cache && cache.expiresAt > Date.now() + 60_000) return cache.token;
    const { clientId, clientSecret } = requiredEnv(env);
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetchImpl(`${SANDBOX_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw await readError(response);
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new PayPalRequestError("PayPal did not return an access token.", response.status);
    }
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 300;
    cache = { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return data.access_token;
  }

  async function paypalRequest(path: string, init: RequestInit): Promise<Response> {
    const token = await accessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    const response = await fetchImpl(`${SANDBOX_BASE}${path}`, { ...init, headers });
    if (!response.ok && response.status !== 204) throw await readError(response);
    return response;
  }

  async function paypalJson(
    path: string,
    init: RequestInit,
    parse: (body: unknown) => PayPalOrderSnapshot | null,
  ): Promise<PayPalOrderSnapshot> {
    const response = await paypalRequest(path, init);
    const snapshot = parse(await response.json());
    if (!snapshot) throw new PayPalRequestError("PayPal returned an unreadable payment resource.", response.status);
    return snapshot;
  }

  return {
    createOrder(input) {
      return paypalJson(
        "/v2/checkout/orders",
        {
          method: "POST",
          headers: {
            "PayPal-Request-Id": input.requestId,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            intent: "AUTHORIZE",
            purchase_units: [
              {
                reference_id: input.sku,
                custom_id: input.customId,
                description: input.description.slice(0, 127),
                amount: {
                  currency_code: input.currency,
                  value: input.amountValue,
                },
              },
            ],
          }),
        },
        readPayPalOrder,
      );
    },
    authorizeOrder(input) {
      return paypalJson(
        `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/authorize`,
        {
          method: "POST",
          headers: {
            "PayPal-Request-Id": input.requestId,
            Prefer: "return=representation",
          },
          body: "{}",
        },
        readPayPalOrder,
      );
    },
    captureAuthorization(input) {
      return paypalJson(
        `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`,
        {
          method: "POST",
          headers: {
            "PayPal-Request-Id": input.requestId,
            Prefer: "return=representation",
          },
          body: "{}",
        },
        readPayPalCapture,
      );
    },
    async voidAuthorization(input) {
      const response = await paypalRequest(
        `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/void`,
        {
          method: "POST",
          headers: {
            "PayPal-Request-Id": input.requestId,
          },
        },
      );
      if (response.status === 204) {
        return {
          id: input.authorizationId,
          status: "ACCEPTED",
          authorizationId: input.authorizationId,
          authorizationStatus: null,
          captureId: null,
          captureStatus: null,
          amountValue: null,
          currency: null,
        };
      }
      const snapshot = readPayPalAuthorization(await response.json());
      if (!snapshot) {
        throw new PayPalRequestError("PayPal returned an unreadable void response.", response.status);
      }
      return snapshot;
    },
    getOrder(orderId) {
      return paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" }, readPayPalOrder);
    },
    getAuthorization(authorizationId) {
      return paypalJson(
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
        { method: "GET" },
        readPayPalAuthorization,
      );
    },
    getCapture(captureId) {
      return paypalJson(
        `/v2/payments/captures/${encodeURIComponent(captureId)}`,
        { method: "GET" },
        readPayPalCapture,
      );
    },
  };
}
