import type { CatalogProduct, FitReason, FitResult } from "@/lib/geometry/fit";

export interface ComparisonView {
  requiredWidthMm: number | null;
  requiredDepthMm: number | null;
  availableWidthMm: number | null;
  availableDepthMm: number | null;
  requiredHorizontalClearanceMm: number | null;
  requiredDepthClearanceMm: number | null;
  budgetMinor: number | null;
  priceMinor: number | null;
  currency: string | null;
}

export interface AssessmentResponse {
  assessmentId: string | null;
  roomId: string | null;
  measurementVersion: number | null;
  policyFingerprint: string | null;
  result: FitResult;
  reasons: FitReason[];
  explanation: string;
  product: CatalogProduct | null;
  comparison: ComparisonView;
}

export interface PaymentView {
  completed: boolean;
  ledgerStatus: string;
  displayStatus: string;
  providerStatus: string;
  orderId: string;
  authorizationId: string | null;
  captureId: string | null;
  amountMinor: number;
  currency: string;
  message: string;
}
