export interface PayPalOrderSnapshot {
  id: string;
  status: string;
  authorizationId: string | null;
  authorizationStatus: string | null;
  captureId: string | null;
  captureStatus: string | null;
  amountValue: string | null;
  currency: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function amountOf(record: Record<string, unknown> | null): { value: string | null; currency: string | null } {
  const amount = asRecord(record?.amount);
  return {
    value: typeof amount?.value === "string" ? amount.value : null,
    currency: typeof amount?.currency_code === "string" ? amount.currency_code : null,
  };
}

/** Reads an Orders v2 resource, including an authorization or capture nested on the first purchase unit. */
export function readPayPalOrder(body: unknown): PayPalOrderSnapshot | null {
  const order = asRecord(body);
  if (!order || typeof order.id !== "string" || typeof order.status !== "string") return null;

  const units = Array.isArray(order.purchase_units) ? order.purchase_units : [];
  const unit = asRecord(units[0]);
  const payments = asRecord(unit?.payments);
  const authorizations = Array.isArray(payments?.authorizations) ? payments.authorizations : [];
  const captures = Array.isArray(payments?.captures) ? payments.captures : [];
  const authorization = asRecord(authorizations[0]);
  const capture = asRecord(captures[0]);
  const amount = amountOf(capture) ?? { value: null, currency: null };
  const authorizationAmount = amountOf(authorization);
  const unitAmount = amountOf(unit);
  const chosen =
    amount.value !== null ? amount : authorizationAmount.value !== null ? authorizationAmount : unitAmount;

  return {
    id: order.id,
    status: order.status,
    authorizationId: typeof authorization?.id === "string" ? authorization.id : null,
    authorizationStatus: typeof authorization?.status === "string" ? authorization.status : null,
    captureId: typeof capture?.id === "string" ? capture.id : null,
    captureStatus: typeof capture?.status === "string" ? capture.status : null,
    amountValue: chosen.value,
    currency: chosen.currency,
  };
}

/** Reads a Payments v2 authorization resource. */
export function readPayPalAuthorization(body: unknown): PayPalOrderSnapshot | null {
  const authorization = asRecord(body);
  if (!authorization || typeof authorization.id !== "string" || typeof authorization.status !== "string") return null;
  const amount = amountOf(authorization);
  return {
    id: authorization.id,
    status: authorization.status,
    authorizationId: authorization.id,
    authorizationStatus: authorization.status,
    captureId: null,
    captureStatus: null,
    amountValue: amount.value,
    currency: amount.currency,
  };
}

/** Reads a Payments v2 capture resource. */
export function readPayPalCapture(body: unknown): PayPalOrderSnapshot | null {
  const capture = asRecord(body);
  if (!capture || typeof capture.id !== "string" || typeof capture.status !== "string") return null;
  const amount = amountOf(capture);
  return {
    id: capture.id,
    status: capture.status,
    authorizationId: null,
    authorizationStatus: null,
    captureId: capture.id,
    captureStatus: capture.status,
    amountValue: amount.value,
    currency: amount.currency,
  };
}
