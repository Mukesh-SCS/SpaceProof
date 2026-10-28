import type { IntentStatus, LedgerStatus as PrismaLedgerStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { CatalogProduct } from "@/lib/geometry/fit";
import type { EvidenceRoom } from "@/lib/policy/fingerprint";
import type { CheckoutContext, CheckoutRepository, OpenPayment, TransactionRecord } from "@/lib/paypal/orders";
import type { LedgerStatus, StoredAssessment } from "@/lib/policy/checkout";

type ProductRow = CatalogProduct & { id: string; title: string };

function productFrom(row: ProductRow): ProductRow {
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    widthMm: row.widthMm,
    depthMm: row.depthMm,
    heightMm: row.heightMm,
    priceMinor: row.priceMinor,
    currency: row.currency,
    available: row.available,
  };
}

function roomFrom(row: {
  id: string;
  availableWidthMm: number;
  availableDepthMm: number;
  requiredHorizontalClearanceMm: number;
  requiredDepthClearanceMm: number;
  budgetMinor: number;
  currency: string;
  confirmedByUser: boolean;
  version: number;
}): EvidenceRoom {
  return {
    id: row.id,
    availableWidthMm: row.availableWidthMm,
    availableDepthMm: row.availableDepthMm,
    requiredHorizontalClearanceMm: row.requiredHorizontalClearanceMm,
    requiredDepthClearanceMm: row.requiredDepthClearanceMm,
    budgetMinor: row.budgetMinor,
    currency: row.currency,
    confirmed: row.confirmedByUser,
    version: row.version,
  };
}

function assessmentFrom(row: {
  id: string;
  result: StoredAssessment["result"];
  measurementVersion: number;
  policyFingerprint: string;
  createdAt: Date;
  roomMeasurementId: string;
  product: { sku: string };
}): StoredAssessment {
  return {
    id: row.id,
    result: row.result,
    productSku: row.product.sku,
    measurementVersion: row.measurementVersion,
    policyFingerprint: row.policyFingerprint,
    createdAt: row.createdAt,
    roomId: row.roomMeasurementId,
  };
}

function intentStatusFor(status: LedgerStatus): IntentStatus {
  switch (status) {
    case "COMPLETED":
      return "CAPTURED";
    case "AUTHORIZED":
      return "AUTHORIZED";
    case "VOIDED":
      return "VOIDED";
    case "CANCELED":
      return "CANCELED";
    case "FAILED":
      return "FAILED";
    case "CREATED":
      return "ORDER_CREATED";
    default:
      return "CONSENTED";
  }
}

const transactionInclude = {
  intent: {
    include: {
      assessment: { include: { room: true, product: true } },
      product: true,
    },
  },
} as const;

export function createCheckoutRepository(): CheckoutRepository {
  return {
    async getContext(assessmentId) {
      const row = await prisma.fitAssessment.findUnique({
        where: { id: assessmentId },
        include: { room: true, product: true },
      });
      if (!row) return null;
      const context: CheckoutContext = {
        assessment: assessmentFrom(row),
        room: roomFrom(row.room),
        product: productFrom(row.product),
      };
      return context;
    },

    async findOpenPayment(assessmentId, amountMinor, currency) {
      const existing = await prisma.paymentTransaction.findFirst({
        where: {
          amountMinor,
          currency,
          paypalOrderId: { not: null },
          ledgerStatus: { in: ["CREATED", "AUTHORIZED", "COMPLETED"] },
          intent: { fitAssessmentId: assessmentId },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!existing?.paypalOrderId) return null;
      if (existing.ledgerStatus === "CREATED") {
        const open: OpenPayment = { kind: "reuse", orderId: existing.paypalOrderId, status: existing.providerStatus };
        return open;
      }
      if (existing.ledgerStatus === "AUTHORIZED") {
        return { kind: "authorized", orderId: existing.paypalOrderId };
      }
      return { kind: "completed", orderId: existing.paypalOrderId };
    },

    async reserve(input) {
      const intent = await prisma.purchaseIntent.create({
        data: {
          fitAssessmentId: input.assessmentId,
          productId: input.productId,
          approvedPriceMinor: input.amountMinor,
          currency: input.currency,
          buyerConsentAt: input.consentAt,
          policyFingerprint: input.policyDigest,
          status: "CONSENTED",
          transaction: {
            create: {
              providerStatus: "PENDING_CREATE",
              ledgerStatus: "PENDING",
              amountMinor: input.amountMinor,
              currency: input.currency,
              createRequestId: input.requestId,
              authorizeRequestId: input.authorizeRequestId,
              captureRequestId: input.captureRequestId,
              voidRequestId: input.voidRequestId,
            },
          },
        },
      });
      return {
        intentId: intent.id,
        requestId: input.requestId,
        authorizeRequestId: input.authorizeRequestId,
        captureRequestId: input.captureRequestId,
        voidRequestId: input.voidRequestId,
      };
    },

    async attachOrder(intentId, order) {
      await prisma.purchaseIntent.update({
        where: { id: intentId },
        data: {
          status: "ORDER_CREATED",
          transaction: {
            update: {
              paypalOrderId: order.id,
              providerStatus: order.status,
              ledgerStatus: "CREATED",
              lastCheckedAt: new Date(),
            },
          },
        },
      });
    },

    async failOrder(intentId, providerStatus) {
      await prisma.purchaseIntent.update({
        where: { id: intentId },
        data: {
          status: "FAILED",
          transaction: {
            update: {
              providerStatus,
              ledgerStatus: "FAILED",
              lastCheckedAt: new Date(),
            },
          },
        },
      });
    },

    async getTransactionByOrderId(orderId) {
      const row = await prisma.paymentTransaction.findUnique({
        where: { paypalOrderId: orderId },
        include: transactionInclude,
      });
      if (!row) return null;
      const record: TransactionRecord = {
        intentId: row.purchaseIntentId,
        orderId,
        ledgerStatus: row.ledgerStatus as LedgerStatus,
        amountMinor: row.amountMinor,
        currency: row.currency,
        authorizationId: row.paypalAuthorizationId,
        captureId: row.paypalCaptureId,
        authorizeRequestId: row.authorizeRequestId,
        captureRequestId: row.captureRequestId,
        voidRequestId: row.voidRequestId,
        providerStatus: row.providerStatus,
        policyFingerprint: row.intent.policyFingerprint,
        buyerConsentAt: row.intent.buyerConsentAt,
        assessment: assessmentFrom(row.intent.assessment),
        room: roomFrom(row.intent.assessment.room),
        product: productFrom(row.intent.product),
      };
      return record;
    },

    async recordOutcome(input) {
      await prisma.purchaseIntent.update({
        where: { id: input.intentId },
        data: {
          status: intentStatusFor(input.ledgerStatus),
          transaction: {
            update: {
              ledgerStatus: input.ledgerStatus as PrismaLedgerStatus,
              providerStatus: input.providerStatus,
              ...(input.authorizationId ? { paypalAuthorizationId: input.authorizationId } : {}),
              ...(input.captureId ? { paypalCaptureId: input.captureId } : {}),
              lastCheckedAt: new Date(),
            },
          },
        },
      });
    },
  };
}
