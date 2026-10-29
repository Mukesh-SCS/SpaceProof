import { createCheckoutRepository } from "@/lib/db/checkout-repo";
import { createPayPalOrder } from "@/lib/paypal/orders";
import { createPayPalGateway } from "@/lib/paypal/gateway";
import { rateLimitedResponse } from "@/lib/rate-limit";

const repo = createCheckoutRepository();
const gateway = createPayPalGateway();

export async function POST(request: Request) {
  const limited = rateLimitedResponse(request, "paypal-orders", 10);
  if (limited) return limited;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ message: "Expected a JSON object." }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.assessmentId !== "string" || body.assessmentId.trim() === "") {
    return Response.json({ message: "A server assessment id is required." }, { status: 400 });
  }

  const result = await createPayPalOrder(
    { repo, gateway },
    {
      assessmentId: body.assessmentId,
      consent: body.consent,
      claimedResult: body.result,
      claimedPriceMinor: body.priceMinor,
      claimedSku: body.sku,
    },
  );

  if (!result.ok) {
    return Response.json(
      { message: result.message, code: result.code, missing: result.missing ?? [] },
      { status: result.httpStatus, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      id: result.orderId,
      orderId: result.orderId,
      status: result.status,
      amountMinor: result.amountMinor,
      currency: result.currency,
      sku: result.sku,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
