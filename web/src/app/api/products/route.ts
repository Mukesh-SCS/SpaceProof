import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  await connection();
  const products = await prisma.product.findMany({
    orderBy: { priceMinor: "asc" },
    select: {
      sku: true,
      title: true,
      widthMm: true,
      depthMm: true,
      heightMm: true,
      priceMinor: true,
      currency: true,
      available: true,
    },
  });
  return Response.json({ products }, { headers: { "Cache-Control": "no-store" } });
}
