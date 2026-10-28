import { createCheckoutRepository } from "@/lib/db/checkout-repo";
import { createPayPalGateway } from "@/lib/paypal/gateway";
import { cancelPayPalOrder } from "@/lib/paypal/orders";

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

  const result = await cancelPayPalOrder({ repo, gateway }, orderId);
  const status = result.ok ? 200 : result.httpStatus;
  return Response.json(
    { ...result, completed: false },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
