import type { FitResult, ProductCategory } from "@/lib/geometry/fit";
import { formatUsd } from "@/lib/money";
import { categoryLabel, lengthLabel } from "@/components/experience";

const tones: Record<FitResult, string> = {
  FIT: "bg-fit/10 text-fit",
  DOES_NOT_FIT: "bg-nofit/10 text-nofit",
  UNCERTAIN: "bg-uncertain/15 text-uncertain",
};

const labels: Record<FitResult, string> = {
  FIT: "Fits",
  DOES_NOT_FIT: "Does not fit",
  UNCERTAIN: "Uncertain",
};

export function DeskSketch({ widthMm, depthMm }: { widthMm: number; depthMm: number }) {
  const width = 88;
  const height = Math.max(36, Math.min(72, Math.round((depthMm / Math.max(widthMm, 1)) * width)));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="text-teal">
      <rect x="1" y="1" width={width - 2} height={height - 2} rx="6" fill="currentColor" opacity="0.12" stroke="currentColor" />
      <line x1="10" y1={height - 8} x2={width - 10} y2={height - 8} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ProductCard({
  title,
  sku,
  widthMm,
  depthMm,
  priceMinor,
  category,
  result,
  explanation,
  selected,
  loading,
  stale,
  onSelect,
  onDetails,
}: {
  title: string;
  sku: string;
  widthMm: number;
  depthMm: number;
  priceMinor: number;
  category?: ProductCategory;
  result?: FitResult;
  explanation: string;
  selected: boolean;
  loading: boolean;
  stale?: boolean;
  onSelect: () => void;
  onDetails: () => void;
}) {
  return (
    <article className={`flex h-full flex-col rounded-2xl border bg-card p-4 ${selected ? "border-teal shadow-sm" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <DeskSketch widthMm={widthMm} depthMm={depthMm} />
        {stale ? (
          <p className="rounded-full bg-uncertain/15 px-3 py-1 text-xs font-semibold text-uncertain">Check again</p>
        ) : result ? (
          <p className={`rounded-full px-3 py-1 text-xs font-semibold ${tones[result]}`}>{labels[result]}</p>
        ) : (
          <p className="text-xs text-ink/50">Not checked</p>
        )}
      </div>
      <p className="mt-3 text-xs font-medium tracking-wide text-teal uppercase">{categoryLabel(category)}</p>
      <h3 className="font-display text-2xl leading-tight">{title}</h3>
      <p className="mt-1 text-sm text-ink/65">
        {lengthLabel(widthMm)} wide · {lengthLabel(depthMm)} deep
      </p>
      <p className="mt-2 text-base font-medium">{formatUsd(priceMinor)}</p>
      <p className="mt-2 flex-1 text-sm leading-6 text-ink/75">{explanation}</p>
      <p className="mt-2 text-xs text-ink/45">{sku}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full bg-teal px-4 text-sm font-medium text-white" onClick={onSelect}>
          {loading ? "Checking…" : selected ? "Selected" : "Select"}
        </button>
        <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={onDetails}>
          View details
        </button>
      </div>
    </article>
  );
}
