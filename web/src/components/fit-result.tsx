import type { AssessmentResponse } from "@/lib/api-types";
import { formatUsd } from "@/lib/money";
import { lengthLabel, verdict } from "@/components/experience";

const tones = {
  FIT: "bg-fit/10 text-fit",
  DOES_NOT_FIT: "bg-nofit/10 text-nofit",
  UNCERTAIN: "bg-uncertain/15 text-uncertain",
} as const;

export function FitResult({ assessment }: { assessment: AssessmentResponse }) {
  const { comparison } = assessment;
  const headline = verdict(assessment.result);
  const showBars =
    comparison.requiredWidthMm !== null &&
    comparison.availableWidthMm !== null &&
    comparison.requiredDepthMm !== null &&
    comparison.availableDepthMm !== null;

  return (
    <div className="space-y-4" aria-live="polite">
      <div>
        <p className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${tones[assessment.result]}`}>
          {headline.label}
        </p>
        <p className="font-display mt-3 text-2xl leading-tight sm:text-3xl">{headline.summary}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Room" value={`${lengthLabel(comparison.availableWidthMm)} wide · ${lengthLabel(comparison.availableDepthMm)} deep`} />
        <Fact
          label="Desk with clearance"
          value={`${lengthLabel(comparison.requiredWidthMm)} wide · ${lengthLabel(comparison.requiredDepthMm)} deep`}
        />
        <Fact
          label="Clearance"
          value={`${lengthLabel(comparison.requiredHorizontalClearanceMm)} side · ${lengthLabel(comparison.requiredDepthClearanceMm)} depth`}
        />
        <Fact
          label="Budget"
          value={
            comparison.priceMinor !== null && comparison.budgetMinor !== null
              ? `${formatUsd(comparison.priceMinor)} of ${formatUsd(comparison.budgetMinor)}`
              : "Not available"
          }
        />
      </dl>
      {showBars ? (
        <div className="space-y-3">
          <DimensionBar label="Width" required={comparison.requiredWidthMm!} available={comparison.availableWidthMm!} />
          <DimensionBar label="Depth" required={comparison.requiredDepthMm!} available={comparison.availableDepthMm!} />
          <Footprint
            roomWidth={comparison.availableWidthMm!}
            roomDepth={comparison.availableDepthMm!}
            deskWidth={Math.max(
              comparison.requiredWidthMm! - (comparison.requiredHorizontalClearanceMm ?? 0),
              0,
            )}
            deskDepth={Math.max(comparison.requiredDepthMm! - (comparison.requiredDepthClearanceMm ?? 0), 0)}
          />
          <p className="text-sm leading-6 text-ink/65">
            Top view of the desk inside the measured floor. The bars include clearance. This is not a 3D model and does
            not certify delivery or assembly.
          </p>
        </div>
      ) : null}
      <details className="rounded-xl border border-line bg-paper px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">View verification details</summary>
        <div className="mt-3 space-y-3 text-sm leading-6">
          <p>{assessment.explanation}</p>
          <ul className="space-y-2">
            {assessment.reasons.map((reason) => (
              <li key={reason.code}>{reason.message}</li>
            ))}
          </ul>
          <p className="text-ink/55">
            {assessment.assessmentId
              ? `Stored assessment ${assessment.assessmentId}${
                  assessment.measurementVersion !== null ? `, room version ${assessment.measurementVersion}` : ""
                }.`
              : "This result was not stored because the measurements were not usable."}
          </p>
        </div>
      </details>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-3">
      <dt className="text-xs font-medium tracking-wide text-ink/55 uppercase">{label}</dt>
      <dd className="mt-1 text-base">{value}</dd>
    </div>
  );
}

function DimensionBar({ label, required, available }: { label: string; required: number; available: number }) {
  const scale = Math.max(required, available, 1);
  const fits = required <= available;
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span>{label}</span>
        <span>
          {lengthLabel(required)} needed · {lengthLabel(available)} available
        </span>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-line">
        <div className="absolute inset-y-0 left-0 bg-ink/15" style={{ width: `${(available / scale) * 100}%` }} />
        <div
          className={`absolute inset-y-0 left-0 ${fits ? "bg-fit" : "bg-nofit"}`}
          style={{ width: `${(required / scale) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Footprint({
  roomWidth,
  roomDepth,
  deskWidth,
  deskDepth,
}: {
  roomWidth: number;
  roomDepth: number;
  deskWidth: number;
  deskDepth: number;
}) {
  const maxWidth = Math.max(roomWidth, deskWidth, 1);
  const maxDepth = Math.max(roomDepth, deskDepth, 1);
  return (
    <div className="relative h-36 rounded-xl border border-dashed border-ink/25 bg-paper" aria-hidden>
      <div
        className="absolute bottom-3 left-3 border border-ink/25 bg-white/80"
        style={{ width: `${(roomWidth / maxWidth) * 86}%`, height: `${(roomDepth / maxDepth) * 78}%` }}
      />
      <div
        className="absolute bottom-3 left-3 border-2 border-teal bg-teal/20"
        style={{ width: `${(deskWidth / maxWidth) * 86}%`, height: `${(deskDepth / maxDepth) * 78}%` }}
      />
    </div>
  );
}
