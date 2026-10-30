-- Shared counters for the public Next.js routes. A restart does not clear this table.
CREATE TABLE "ApiRateWindow" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiRateWindow_pkey" PRIMARY KEY ("key")
);
