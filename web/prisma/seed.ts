import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedFile {
  products: Array<{
    sku: string;
    title: string;
    category?: "desk" | "dining_table";
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
    throw new Error(`${label} currency must be USD.`);
  }
  if (typeof value.available !== "boolean") {
    throw new Error(`${label}.available must be boolean.`);
  }
}

async function main() {
  const filePath = path.resolve(process.cwd(), "..", "data", "products.json");
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as SeedFile;
  if (!Array.isArray(parsed.products) || parsed.products.length < 12 || parsed.products.length > 20) {
    throw new Error("The demo catalog must contain 12 to 20 products.");
  }
  const desks = parsed.products.filter((product) => (product.category ?? "desk") === "desk");
  const tables = parsed.products.filter((product) => product.category === "dining_table");
  if (desks.length !== 12) {
    throw new Error("The demo catalog must keep the 12 desks.");
  }
  if (tables.length < 3 || tables.length > 5) {
    throw new Error("The demo catalog must contain 3 to 5 compact dining tables.");
  }
  parsed.products.forEach(assertProduct);
  const bySku = new Map(parsed.products.map((product) => [product.sku, product]));
  const nook = bySku.get("DESK-NOOK-100");
  const studio = bySku.get("DESK-STUDIO-140");
  if (!nook || nook.widthMm !== 1000 || nook.priceMinor !== 12900) {
    throw new Error("DESK-NOOK-100 must stay a 100 cm desk at $129.00.");
  }
  if (!studio || studio.widthMm !== 1400 || studio.priceMinor !== 21900) {
    throw new Error("DESK-STUDIO-140 must stay a 140 cm desk at $219.00.");
  }
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
        category: product.category ?? "desk",
        widthMm: product.widthMm,
        depthMm: product.depthMm,
        heightMm: product.heightMm,
        priceMinor: product.priceMinor,
        currency: product.currency,
        available: product.available,
      },
      create: {
        sku: product.sku,
        title: product.title,
        category: product.category ?? "desk",
        widthMm: product.widthMm,
        depthMm: product.depthMm,
        heightMm: product.heightMm,
        priceMinor: product.priceMinor,
        currency: product.currency,
        available: product.available,
      },
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
