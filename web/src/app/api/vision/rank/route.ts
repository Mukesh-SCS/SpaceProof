import { rateLimitedResponse } from "@/lib/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { explanationsForTrustedProducts, type ModelRanking, type TrustedDesk } from "@/lib/vision/rank";
import { forwardVisionJson } from "@/lib/vision/proxy";

function reasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object" && "code" in item && typeof item.code === "string") return [item.code];
    return [];
  });
}

export async function POST(request: Request) {
  const limited = rateLimitedResponse(request, "vision-rank", 20);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const requestText = typeof record.requestText === "string" ? record.requestText.slice(0, 2000) : "";
  const assessmentIds = Array.isArray(record.assessmentIds)
    ? record.assessmentIds.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  if (assessmentIds.length === 0) {
    return Response.json({ message: "Check the desks before asking for an explanation." }, { status: 400 });
  }

  const rows = await prisma.fitAssessment.findMany({
    where: { id: { in: assessmentIds } },
    include: { product: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const trusted: TrustedDesk[] = [];
  const seen = new Set<string>();
  for (const id of assessmentIds) {
    const row = byId.get(id);
    if (!row || seen.has(row.product.sku)) continue;
    seen.add(row.product.sku);
    if (row.result !== "FIT" && row.result !== "DOES_NOT_FIT" && row.result !== "UNCERTAIN") continue;
    trusted.push({
      sku: row.product.sku,
      title: row.product.title,
      result: row.result,
      priceMinor: row.product.priceMinor,
      reasons: reasonCodes(row.reasons),
    });
  }
  if (trusted.length === 0) {
    return Response.json({ message: "Those assessments are not in the catalog." }, { status: 404 });
  }

  const response = await forwardVisionJson("/rank-products", {
    request_text: requestText,
    products: trusted.map((item) => ({
      sku: item.sku,
      title: item.title,
      result: item.result,
      price_minor: item.priceMinor,
      reasons: item.reasons,
    })),
  });
  if (!response.ok) return response;
  const payload = (await response.json()) as { rankings?: ModelRanking[] };
  const rankings = explanationsForTrustedProducts(trusted, payload.rankings ?? []);
  return Response.json({ rankings }, { headers: { "Cache-Control": "no-store" } });
}
