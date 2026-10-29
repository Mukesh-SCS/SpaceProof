-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('desk', 'dining_table');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "category" "ProductCategory" NOT NULL DEFAULT 'desk';
