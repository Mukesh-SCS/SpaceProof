import { describe, expect, it, vi } from "vitest";
import { createPayPalGateway, PayPalConfigError } from "@/lib/paypal/gateway";
import { describePayPalSetup } from "@/lib/paypal/setup";

describe("PayPal sandbox gateway", () => {
  it("refuses to call PayPal when credentials are missing", async () => {
    const fetchImpl = vi.fn();
    const gateway = createPayPalGateway({ PAYPAL_ENVIRONMENT: "sandbox" }, fetchImpl);
    await expect(
      gateway.createOrder({
        requestId: "req-1",
        amountValue: "129.00",
        currency: "USD",
        sku: "DESK-NOOK-100",
        description: "Nook Desk",
        customId: "intent-1",
      }),
    ).rejects.toBeInstanceOf(PayPalConfigError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a sandbox AUTHORIZE order with the server amount and a request id", async () => {
    const secret = "super-secret-value";
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "token-1", expires_in: 300 }), { status: 200 });
      }
      if (href.endsWith("/v2/checkout/orders") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            id: "ORDER-1",
            status: "CREATED",
            purchase_units: [{ amount: { currency_code: "USD", value: "129.00" } }],
          }),
          { status: 201 },
        );
      }
      if (href.endsWith("/v2/checkout/orders/ORDER-1/authorize")) {
        return new Response(
          JSON.stringify({
            id: "ORDER-1",
            status: "COMPLETED",
            purchase_units: [
              {
                payments: {
                  authorizations: [
                    { id: "AUTH-1", status: "CREATED", amount: { currency_code: "USD", value: "129.00" } },
                  ],
                },
              },
            ],
          }),
          { status: 201 },
        );
      }
      if (href.endsWith("/v2/payments/authorizations/AUTH-1/capture")) {
        return new Response(
          JSON.stringify({ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "129.00" } }),
          { status: 201 },
        );
      }
      if (href.endsWith("/v2/payments/authorizations/AUTH-1/void")) {
        return new Response(null, { status: 204 });
      }
      return new Response("unexpected", { status: 500 });
    });

    const gateway = createPayPalGateway(
      {
        PAYPAL_ENVIRONMENT: "sandbox",
        PAYPAL_CLIENT_ID: "public-client",
        PAYPAL_CLIENT_SECRET: secret,
      },
      fetchImpl as typeof fetch,
    );

    const order = await gateway.createOrder({
      requestId: "req-create",
      amountValue: "129.00",
      currency: "USD",
      sku: "DESK-NOOK-100",
      description: "Nook Desk",
      customId: "intent-1",
    });
    expect(order.id).toBe("ORDER-1");
    expect(order.authorizationId).toBeNull();

    const authorized = await gateway.authorizeOrder({ orderId: "ORDER-1", requestId: "req-auth" });
    expect(authorized.authorizationId).toBe("AUTH-1");
    expect(authorized.authorizationStatus).toBe("CREATED");
    expect(authorized.status).toBe("COMPLETED");

    const captured = await gateway.captureAuthorization({ authorizationId: "AUTH-1", requestId: "req-capture" });
    expect(captured.captureId).toBe("CAP-1");
    expect(captured.captureStatus).toBe("COMPLETED");

    const voided = await gateway.voidAuthorization({ authorizationId: "AUTH-1", requestId: "req-void" });
    expect(voided.status).toBe("ACCEPTED");
    expect(voided.captureId).toBeNull();

    const createCall = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(createCall[0]).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const createHeaders = createCall[1].headers as Headers;
    expect(createHeaders.get("Authorization")).toBe("Bearer token-1");
    expect(createHeaders.get("PayPal-Request-Id")).toBe("req-create");
    const body = JSON.parse(String(createCall[1].body));
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "129.00" });
    expect(JSON.stringify(body)).not.toContain(secret);

    const authorizeCall = fetchImpl.mock.calls[2] as [string, RequestInit];
    expect(authorizeCall[0]).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1/authorize");
    const captureCall = fetchImpl.mock.calls[3] as [string, RequestInit];
    expect(captureCall[0]).toBe("https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/capture");
    expect(captureCall[1].body).toBe("{}");
    const voidCall = fetchImpl.mock.calls[4] as [string, RequestInit];
    expect(voidCall[0]).toBe("https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/void");
  });

  it("does not put the client secret in the public setup description", () => {
    const setup = describePayPalSetup({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "super-secret-value",
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: "client",
      PAYPAL_ENVIRONMENT: "sandbox",
    });
    expect(setup.ready).toBe(true);
    expect(setup.clientId).toBe("client");
    expect(JSON.stringify(setup)).not.toContain("super-secret-value");
  });
});
