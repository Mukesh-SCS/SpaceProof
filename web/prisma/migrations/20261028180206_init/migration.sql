-- CreateEnum
CREATE TYPE "FitResult" AS ENUM ('FIT', 'DOES_NOT_FIT', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('CONSENTED', 'ORDER_CREATED', 'AUTHORIZED', 'CAPTURED', 'VOIDED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('PENDING', 'CREATED', 'AUTHORIZED', 'COMPLETED', 'VOIDED', 'CANCELED', 'FAILED');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "depthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMeasurement" (
    "id" TEXT NOT NULL,
    "availableWidthMm" INTEGER NOT NULL,
    "availableDepthMm" INTEGER NOT NULL,
    "requiredHorizontalClearanceMm" INTEGER NOT NULL,
    "requiredDepthClearanceMm" INTEGER NOT NULL,
    "budgetMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "confirmedByUser" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitAssessment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "roomMeasurementId" TEXT NOT NULL,
    "measurementVersion" INTEGER NOT NULL,
    "result" "FitResult" NOT NULL,
    "reasons" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "policyFingerprint" TEXT NOT NULL,
    "productWidthMm" INTEGER NOT NULL,
    "productDepthMm" INTEGER NOT NULL,
    "productHeightMm" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "requiredWidthMm" INTEGER,
    "requiredDepthMm" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseIntent" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fitAssessmentId" TEXT NOT NULL,
    "approvedPriceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "buyerConsentAt" TIMESTAMP(3),
    "policyFingerprint" TEXT NOT NULL,
    "status" "IntentStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "purchaseIntentId" TEXT NOT NULL,
    "paypalOrderId" TEXT,
    "paypalAuthorizationId" TEXT,
    "paypalCaptureId" TEXT,
    "providerStatus" TEXT NOT NULL,
    "ledgerStatus" "LedgerStatus" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createRequestId" TEXT NOT NULL,
    "authorizeRequestId" TEXT NOT NULL,
    "captureRequestId" TEXT NOT NULL,
    "voidRequestId" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "FitAssessment_productId_idx" ON "FitAssessment"("productId");

-- CreateIndex
CREATE INDEX "FitAssessment_roomMeasurementId_idx" ON "FitAssessment"("roomMeasurementId");

-- CreateIndex
CREATE INDEX "PurchaseIntent_fitAssessmentId_idx" ON "PurchaseIntent"("fitAssessmentId");

-- CreateIndex
CREATE INDEX "PurchaseIntent_productId_idx" ON "PurchaseIntent"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_purchaseIntentId_key" ON "PaymentTransaction"("purchaseIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_paypalOrderId_key" ON "PaymentTransaction"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_paypalAuthorizationId_key" ON "PaymentTransaction"("paypalAuthorizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_paypalCaptureId_key" ON "PaymentTransaction"("paypalCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_createRequestId_key" ON "PaymentTransaction"("createRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_authorizeRequestId_key" ON "PaymentTransaction"("authorizeRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_captureRequestId_key" ON "PaymentTransaction"("captureRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_voidRequestId_key" ON "PaymentTransaction"("voidRequestId");

-- AddForeignKey
ALTER TABLE "FitAssessment" ADD CONSTRAINT "FitAssessment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitAssessment" ADD CONSTRAINT "FitAssessment_roomMeasurementId_fkey" FOREIGN KEY ("roomMeasurementId") REFERENCES "RoomMeasurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseIntent" ADD CONSTRAINT "PurchaseIntent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseIntent" ADD CONSTRAINT "PurchaseIntent_fitAssessmentId_fkey" FOREIGN KEY ("fitAssessmentId") REFERENCES "FitAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_purchaseIntentId_fkey" FOREIGN KEY ("purchaseIntentId") REFERENCES "PurchaseIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
