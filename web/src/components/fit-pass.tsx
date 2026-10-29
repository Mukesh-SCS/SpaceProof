import type { AssessmentResponse } from "@/lib/api-types";
import { categoryLabel, paymentBuyerLabel } from "@/components/experience";
import { FitResult } from "@/components/fit-result";
import { confirmationStatement } from "@/lib/scene-freshness";

/**
 * FitPass is the checked-constraint record for one product.
 * It is not a physical certification and it does not sign the evidence.
 */
export function FitPass({
  assessment,
  current,
  widthMm,
  depthMm,
  paymentStatus,
}: {
  assessment: AssessmentResponse;
  current: boolean;
  widthMm: number | null;
  depthMm: number | null;
  paymentStatus: string | null;
}) {
  const category = categoryLabel(assessment.product?.category);
  const sku = assessment.product?.sku ?? "Unstored";
  return (
    <section aria-label="SpaceProof FitPass" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-teal uppercase">SpaceProof FitPass</p>
          <h2 className="font-display mt-1 text-3xl">Checked constraints</h2>
        </div>
        <p className={`rounded-full px-3 py-1 text-sm font-semibold ${current ? "bg-fit/10 text-fit" : "bg-uncertain/15 text-uncertain"}`}>
          {current ? "Current" : "Out of date"}
        </p>
      </div>
      <p className="text-sm leading-6 text-ink/75">
        {confirmationStatement(widthMm, depthMm)} The buyer entered these measurements. The photograph did not supply them.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper px-3 py-3">
          <dt className="text-xs font-medium tracking-wide text-ink/55 uppercase">Product</dt>
          <dd className="mt-1 text-base">
            {sku} · {category}
          </dd>
        </div>
        <div className="rounded-xl border border-line bg-paper px-3 py-3">
          <dt className="text-xs font-medium tracking-wide text-ink/55 uppercase">Evidence</dt>
          <dd className="mt-1 text-base">
            {assessment.assessmentId
              ? `Version ${assessment.measurementVersion ?? "—"}`
              : "Not stored"}
            {assessment.createdAt ? ` · ${assessment.createdAt.slice(0, 16).replace("T", " ")} UTC` : ""}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-ink/75">Linked payment: {paymentBuyerLabel(paymentStatus)}</p>
      {!current ? (
        <p className="text-sm leading-6 text-uncertain">
          The photograph, placement, or measurements changed after this check. PayPal stays closed until the server stores a new FitPass.
        </p>
      ) : null}
      <FitResult assessment={assessment} />
      <p className="text-xs leading-5 text-ink/55">
        FitPass records the constraints that were checked. It does not certify real-world fit, delivery, or installation.
      </p>
    </section>
  );
}
