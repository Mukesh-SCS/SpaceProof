import type { PaymentView } from "@/lib/api-types";
import type { FitResult, ProductCategory } from "@/lib/geometry/fit";
import { inchesLabel, lengthLabel } from "@/lib/imperial";
import { formatUsd } from "@/lib/money";

export { inchesLabel, lengthLabel };

export type CatalogFilter = "all" | "FIT" | "DOES_NOT_FIT" | "UNCERTAIN";
export type CategoryFilter = "all" | ProductCategory;

export type WorkflowState =
  | "UPLOADING"
  | "NEEDS_MEASUREMENTS"
  | "READY_TO_VERIFY"
  | "VERIFYING"
  | "FIT"
  | "DOES_NOT_FIT"
  | "UNCERTAIN"
  | "PAYMENT_PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "VOIDED"
  | "FAILED";

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

export function purchaseStages(input: {
  confirmed: boolean;
  hasCurrentAssessment: boolean;
  paymentSettled: boolean;
}): JourneyStep[] {
  const done = [input.confirmed, input.hasCurrentAssessment, input.paymentSettled];
  const lastDone = done.lastIndexOf(true);
  const currentIndex = done.findIndex((item, index) => !item && index > lastDone);
  const labels = [
    ["upload", "Understand"],
    ["verify", "Compare"],
    ["pay", "Pay"],
  ] as const;
  return labels.map(([id, label], index) => ({
    id,
    label,
    state: done[index] ? "done" : index === currentIndex ? "current" : "waiting",
  }));
}

export function workflowState(input: {
  uploading: boolean;
  confirmed: boolean;
  verifying: boolean;
  selectedResult: FitResult | null;
  selectedCurrent: boolean;
  paymentStatus: string | null;
}): WorkflowState {
  if (input.uploading) return "UPLOADING";
  if (input.paymentStatus === "CAPTURED") return "CAPTURED";
  if (input.paymentStatus === "VOIDED") return "VOIDED";
  if (input.paymentStatus === "FAILED") return "FAILED";
  if (input.paymentStatus === "CANCELED") return "FAILED";
  if (input.paymentStatus === "AUTHORIZED") return "AUTHORIZED";
  if (input.paymentStatus === "CREATED" || input.paymentStatus === "PENDING") return "PAYMENT_PENDING";
  if (input.verifying) return "VERIFYING";
  if (!input.confirmed) return "NEEDS_MEASUREMENTS";
  if (!input.selectedCurrent || !input.selectedResult) return "READY_TO_VERIFY";
  return input.selectedResult;
}

export function categoryLabel(category: ProductCategory | undefined): string {
  return category === "dining_table" ? "Dining table" : "Desk";
}

export function selectCatalog<T extends { sku: string; category?: ProductCategory }>(
  products: T[],
  results: Record<string, FitResult | undefined>,
  filter: CatalogFilter,
  selectedSku: string | null,
  showAll: boolean,
  category: CategoryFilter = "all",
): { shown: T[]; hidden: number } {
  const inCategory = products.filter((product) => category === "all" || (product.category ?? "desk") === category);
  const filtered = inCategory.filter((product) => filter === "all" || results[product.sku] === filter);
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

export function verdict(result: FitResult): { label: string; summary: string } {
  if (result === "FIT") {
    return { label: "Fits", summary: "The confirmed space can hold this item." };
  }
  if (result === "DOES_NOT_FIT") {
    return { label: "Does not fit", summary: "Checkout stays closed for this item." };
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
  if (input.result === "DOES_NOT_FIT") return "This item does not fit the confirmed space, so PayPal stays closed.";
  if (input.result === "UNCERTAIN") return "The measurement is not confirmed, so PayPal stays closed.";
  if (input.sceneDirty) return "The room changed after this check. Verify the product again before payment.";
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
