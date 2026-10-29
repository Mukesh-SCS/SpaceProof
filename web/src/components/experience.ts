import type { PaymentView } from "@/lib/api-types";
import type { FitResult } from "@/lib/geometry/fit";
import { formatUsd } from "@/lib/money";

export type CatalogFilter = "all" | "FIT" | "DOES_NOT_FIT" | "UNCERTAIN";

export interface JourneyStep {
  id: "upload" | "measure" | "verify" | "pay";
  label: string;
  state: "done" | "current" | "waiting";
}

export function journeySteps(input: {
  hasPhoto: boolean;
  measurementsConfirmed: boolean;
  hasCurrentAssessment: boolean;
  paymentSettled: boolean;
}): JourneyStep[] {
  const done = [
    input.hasPhoto,
    input.measurementsConfirmed,
    input.hasCurrentAssessment,
    input.paymentSettled,
  ];
  const lastDone = done.lastIndexOf(true);
  const currentIndex = done.findIndex((item, index) => !item && index > lastDone);
  const labels = [
    ["upload", "Upload"],
    ["measure", "Measure"],
    ["verify", "Verify"],
    ["pay", "Pay"],
  ] as const;
  return labels.map(([id, label], index) => ({
    id,
    label,
    state: done[index] ? "done" : index === currentIndex ? "current" : "waiting",
  }));
}

export function selectCatalog<T extends { sku: string }>(
  products: T[],
  results: Record<string, FitResult | undefined>,
  filter: CatalogFilter,
  selectedSku: string | null,
  showAll: boolean,
): { shown: T[]; hidden: number } {
  const filtered = products.filter((product) => filter === "all" || results[product.sku] === filter);
  if (showAll || filter !== "all") return { shown: filtered, hidden: 0 };
  const compatible = filtered.filter((product) => results[product.sku] === "FIT");
  const pool = compatible.length > 0 ? compatible.slice(0, 6) : filtered.slice(0, 3);
  const shown = [...pool];
  if (selectedSku && !shown.some((item) => item.sku === selectedSku)) {
    const selected = filtered.find((item) => item.sku === selectedSku);
    if (selected) shown.unshift(selected);
  }
  return { shown, hidden: Math.max(filtered.length - shown.length, 0) };
}

export function lengthLabel(millimeters: number | null): string {
  if (millimeters === null || !Number.isFinite(millimeters)) return "Not available";
  if (millimeters % 10 === 0) return `${millimeters / 10} cm`;
  return `${(millimeters / 10).toFixed(1)} cm`;
}

export function verdict(result: FitResult): { label: string; summary: string } {
  if (result === "FIT") {
    return { label: "Fits", summary: "The confirmed space can hold this desk." };
  }
  if (result === "DOES_NOT_FIT") {
    return { label: "Does not fit", summary: "Checkout stays closed for this desk." };
  }
  return { label: "Uncertain", summary: "SpaceProof needs a confirmed measurement before checkout." };
}

export function checkoutClosedReason(input: {
  result: FitResult | null;
  confirmed: boolean;
  sceneDirty: boolean;
  consented: boolean;
}): string | null {
  if (!input.result) return "Check this desk before payment can open.";
  if (input.result === "DOES_NOT_FIT") return "This desk does not fit the confirmed space, so PayPal stays closed.";
  if (input.result === "UNCERTAIN") return "The measurement is not confirmed, so PayPal stays closed.";
  if (input.sceneDirty) return "The room changed after this check. Verify the desk again before payment.";
  if (!input.confirmed) return "Confirm the measurements before payment.";
  if (!input.consented) return "Approve the catalog price to open PayPal.";
  return null;
}

export function paymentPresentation(payment: PaymentView): {
  status: string;
  settled: boolean;
  authorized: boolean;
  receipt: boolean;
  voided: boolean;
  amount: string;
} {
  const status = payment.displayStatus;
  const receipt = payment.completed === true && status === "CAPTURED" && Boolean(payment.captureId);
  return {
    status,
    settled: receipt || status === "VOIDED" || status === "CANCELED" || status === "FAILED",
    authorized: payment.ledgerStatus === "AUTHORIZED" && payment.completed !== true,
    receipt,
    voided: status === "VOIDED",
    amount: formatUsd(payment.amountMinor),
  };
}

export const STALE_ASSESSMENT_NOTICE =
  "The room or placement changed after the last check. Earlier fit results cannot capture a payment until you verify again.";
