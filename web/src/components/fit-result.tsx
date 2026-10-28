import type { AssessmentResponse } from "@/lib/api-types";
import { formatUsd } from "@/lib/money";

const labels = {
  FIT: "FIT",
  DOES_NOT_FIT: "DOES NOT FIT",
  UNCERTAIN: "UNCERTAIN",
} as const;

const tones = {
  FIT: "bg-fit/10 text-fit",
  DOES_NOT_FIT: "bg-nofit/10 text-nofit",
  UNCERTAIN: "bg-uncertain/15 text-uncertain",
} as const;

export function FitResult({ assessment }: { assessment: AssessmentResponse }) {
  const { comparison } = assessment;
  const showBars =
    comparison.requiredWidthMm !== null &&
    comparison.availableWidthMm !== null &&
    comparison.requiredDepthMm !== null &&
    comparison.availableDepthMm !== null &&
    comparison.requiredHorizontalClearanceMm !== null &&
    comparison.requiredDepthClearanceMm !== null;

  return (
    <div className="mt-4 space-y-4" aria-live="polite">
      <p className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${tones[assessment.result]}`}>
        {labels[assessment.result]}
      </p>
      <p className="text-sm leading-6">{assessment.explanation}</p>
      <ul className="space-y-2 text-sm leading-6">
        {assessment.reasons.map((reason) => (
          <li key={reason.code}>
            <span className="font-medium">{reason.code}.</span> {reason.message}
          </li>
        ))}
      </ul>
      {showBars ? (
        <div className="space-y-3">
          <DimensionBar label="Width" required={comparison.requiredWidthMm!} available={comparison.availableWidthMm!} />
          <DimensionBar label="Depth" required={comparison.requiredDepthMm!} available={comparison.availableDepthMm!} />
          {comparison.priceMinor !== null && comparison.budgetMinor !== null ? (
            <p className="text-sm text-ink/70">
              Catalog price {formatUsd(comparison.priceMinor)} · budget {formatUsd(comparison.budgetMinor)}
            </p>
          ) : null}
          <Footprint
            roomWidth={comparison.availableWidthMm!}
            roomDepth={comparison.availableDepthMm!}
            deskWidth={Math.max(comparison.requiredWidthMm! - comparison.requiredHorizontalClearanceMm!, 0)}
            deskDepth={Math.max(comparison.requiredDepthMm! - comparison.requiredDepthClearanceMm!, 0)}
          />
          <p className="text-xs leading-5 text-ink/60">
            Top view of the desk footprint inside the measured floor. The bars include clearance. This is not a 3D
            model, and it does not certify delivery or assembly clearance.
          </p>
        </div>
      ) : null}
      {assessment.assessmentId ? (
        <p className="text-xs text-ink/50">
          Assessment {assessment.assessmentId}
          {assessment.measurementVersion !== null ? ` · room version ${assessment.measurementVersion}` : ""}
        </p>
      ) : (
        <p className="text-xs text-ink/50">This result was not stored because the measurements were not usable.</p>
      )}
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
          {required} mm required · {available} mm available
        </span>
      </div>
      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-line">
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
    <div className="relative h-40 rounded-xl border border-dashed border-ink/30 bg-paper" aria-hidden>
      <div
        className="absolute bottom-3 left-3 border border-ink/30 bg-white/80"
        style={{ width: `${(roomWidth / maxWidth) * 86}%`, height: `${(roomDepth / maxDepth) * 78}%` }}
      />
      <div
        className="absolute bottom-3 left-3 border-2 border-teal bg-teal/20"
        style={{ width: `${(deskWidth / maxWidth) * 86}%`, height: `${(deskDepth / maxDepth) * 78}%` }}
      />
    </div>
  );
}
