export interface TrustedDesk {
  sku: string;
  title: string;
  result: "FIT" | "DOES_NOT_FIT" | "UNCERTAIN";
  priceMinor: number;
  reasons: string[];
}

export interface ModelRanking {
  sku?: unknown;
  explanation?: unknown;
  result?: unknown;
  priceMinor?: unknown;
  price_minor?: unknown;
}

/**
 * The model may order and explain desks.
 * Fit results and prices stay on the trusted catalog records.
 */
export function explanationsForTrustedProducts(
  trusted: TrustedDesk[],
  model: ModelRanking[],
): Array<TrustedDesk & { explanation: string }> {
  const explanations = new Map<string, string>();
  const order: string[] = [];
  for (const item of model) {
    if (typeof item.sku !== "string") continue;
    order.push(item.sku);
    if (typeof item.explanation === "string" && item.explanation.trim()) {
      explanations.set(item.sku, item.explanation.trim().slice(0, 500));
    }
  }
  const bySku = new Map(trusted.map((item) => [item.sku, item]));
  const ranked: Array<TrustedDesk & { explanation: string }> = [];
  const seen = new Set<string>();
  for (const sku of order) {
    const item = bySku.get(sku);
    if (!item || seen.has(sku)) continue;
    seen.add(sku);
    ranked.push({
      ...item,
      explanation: explanations.get(sku) ?? "The geometry result is unchanged.",
    });
  }
  for (const item of trusted) {
    if (seen.has(item.sku)) continue;
    ranked.push({
      ...item,
      explanation: "The model did not comment on this desk. The geometry result is unchanged.",
    });
  }
  return ranked;
}
