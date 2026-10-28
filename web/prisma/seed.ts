import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedFile {
  products: Array<{
    sku: string;
    title: string;
    widthMm: number;
    depthMm: number;
    heightMm: number;
    priceMinor: number;
    currency: string;
    available: boolean;
  }>;
}

function assertProduct(value: SeedFile["products"][number], index: number): void {
  const label = `products[${index}]`;
  if (!value || typeof value.sku !== "string" || !value.sku.trim()) {
    throw new Error(`${label} is missing a SKU.`);
  }
  for (const key of ["widthMm", "depthMm", "heightMm", "priceMinor"] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new Error(`${label}.${key} must be a non-negative integer.`);
    }
  }
  if (value.widthMm <= 0 || value.depthMm <= 0 || value.heightMm <= 0) {
    throw new Error(`${label} dimensions must be greater than zero.`);
  }
  if (value.currency !== "USD") {
    throw new Error(`${label} currency must be USD for Milestone 1.`);
  }
  if (typeof value.available !== "boolean") {
    throw new Error(`${label}.available must be boolean.`);
  }
}

async function main() {
  const filePath = path.resolve(process.cwd(), "..", "data", "products.json");
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as SeedFile;
  if (!Array.isArray(parsed.products) || parsed.products.length !== 2) {
    throw new Error("Milestone 1 seed must contain exactly two products.");
  }
  parsed.products.forEach(assertProduct);
  if (
    parsed.products[0].widthMm === parsed.products[1].widthMm &&
    parsed.products[0].depthMm === parsed.products[1].depthMm
  ) {
    throw new Error("The two seed desks must have different dimensions.");
  }

  for (const product of parsed.products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        title: product.title,
        widthMm: product.widthMm,
        depthMm: product.depthMm,
        heightMm: product.heightMm,
        priceMinor: product.priceMinor,
        currency: product.currency,
        available: product.available,
      },
      create: product,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
