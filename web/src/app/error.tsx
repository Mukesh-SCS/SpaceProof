"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="font-display text-3xl text-ink">SpaceProof hit an unexpected error.</h1>
      <p className="mt-3 text-ink/80">The page could not be shown. Your payment status was not changed by this screen.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-full bg-ink px-4 py-2 text-sm text-paper"
      >
        Try again
      </button>
    </main>
  );
}
