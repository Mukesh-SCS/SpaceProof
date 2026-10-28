import { createCheckoutRepository } from "@/lib/db/checkout-repo";
import { createPayPalGateway } from "@/lib/paypal/gateway";
import { voidPayPalOrder } from "@/lib/paypal/orders";

const repo = createCheckoutRepository();
const gateway = createPayPalGateway();

export async function POST(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await context.params;
  if (!orderId) {
    return Response.json({ message: "PayPal order id is required." }, { status: 400 });
  }

  const result = await voidPayPalOrder({ repo, gateway }, orderId);
  if (!result.ok) {
    return Response.json(
      { message: result.message, code: result.code, completed: false },
      { status: result.httpStatus, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
