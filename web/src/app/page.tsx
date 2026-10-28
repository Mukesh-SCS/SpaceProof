import { Suspense } from "react";
import { connection } from "next/server";
import { Workspace } from "@/components/workspace";
import { prisma } from "@/lib/db/prisma";
import { describePayPalSetup, paypalConfigurationMessage } from "@/lib/paypal/setup";
import type { CatalogProduct } from "@/lib/geometry/fit";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-8">
        <div className="ruler mb-4" aria-hidden />
        <p className="text-xs font-medium tracking-[0.18em] text-teal uppercase">PayPal sandbox · desks only</p>
        <h1 className="font-display mt-2 text-4xl text-ink sm:text-5xl">SpaceProof</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/80">Verify before you pay.</p>
        <p className="mt-2 max-w-3xl text-base leading-7 text-ink/75">
          Upload a room photo, confirm the real width and depth, and let the server decide which desks fit. PayPal
          can authorize a payment only after that decision is FIT. Capture happens later, after a fresh check. A
          photograph is not a measurement, and a fit result is not a guarantee of physical compatibility.
        </p>
      </header>
      <Suspense fallback={<p className="text-ink/70">Loading the desk catalog…</p>}>
        <Catalog />
      </Suspense>
    </main>
  );
}

async function Catalog() {
  await connection();
  let products: CatalogProduct[] = [];
  try {
    products = await prisma.product.findMany({
      orderBy: { priceMinor: "asc" },
      select: {
        sku: true,
        title: true,
        widthMm: true,
        depthMm: true,
        heightMm: true,
        priceMinor: true,
        currency: true,
        available: true,
      },
    });
  } catch {
    return (
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-2xl">The catalog is unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-ink/80">
          Start PostgreSQL with Docker Compose, then from the web directory run the Prisma migration and
          seed. The commands are in the root README.
        </p>
      </section>
    );
  }

  if (products.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-2xl">The catalog is empty</h2>
        <p className="mt-2 text-base text-ink/80">Run the Prisma seed to load the demo desks.</p>
      </section>
    );
  }

  const setup = describePayPalSetup({
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
    PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT,
  });

  return (
    <Workspace
      products={products}
      paypal={{
        ready: setup.ready,
        clientId: setup.clientId,
        message: setup.ready ? null : paypalConfigurationMessage(setup.missing),
      }}
    />
  );
}
