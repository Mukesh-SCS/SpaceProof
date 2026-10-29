"use client";

import { useMemo, useState } from "react";
import type { AssessmentResponse, PaymentView } from "@/lib/api-types";
import { DEMO_ROOM } from "@/lib/demo-scenario";
import type { CatalogProduct } from "@/lib/geometry/fit";
import { formatUsd, parseUsdToMinor } from "@/lib/money";
import type { PlacementBox } from "@/lib/scene";
import {
  checkoutClosedReason,
  journeySteps,
  selectCatalog,
  STALE_ASSESSMENT_NOTICE,
  verdict,
  type CatalogFilter,
} from "@/components/experience";
import { FitResult } from "@/components/fit-result";
import { PaymentStatus } from "@/components/payment-status";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { PlacementEditor, type NormBox } from "@/components/placement-editor";
import { ProductCard } from "@/components/product-card";

interface CardState {
  phase: "idle" | "loading" | "done" | "error";
  assessment?: AssessmentResponse;
  error?: string;
}

interface AnalysisView {
  room_description?: string;
  placement_candidates?: Array<{
    id: string;
    label: string;
    bbox_normalized: number[];
    confidence: number;
    reason: string;
  }>;
  visible_obstacles?: Array<{ label: string; bbox_normalized: number[] | null; note?: string }>;
  measurement_questions?: string[];
  warnings?: string[];
  dimensions_mm?: null;
  message?: string;
}

interface PreferenceView {
  product_category?: string;
  maximum_budget_minor?: number | null;
  horizontal_clearance_mm?: number | null;
  depth_clearance_mm?: number | null;
  style_preferences?: string[];
  unresolved_questions?: string[];
  warnings?: string[];
  message?: string;
}

interface RankNote {
  sku: string;
  explanation: string;
  result: string;
  priceMinor: number;
}

export function Workspace({
  products,
  paypal,
}: {
  products: CatalogProduct[];
  paypal: { ready: boolean; clientId: string | null; message: string | null };
}) {
  const [widthCm, setWidthCm] = useState(String(DEMO_ROOM.availableWidthMm / 10));
  const [depthCm, setDepthCm] = useState(String(DEMO_ROOM.availableDepthMm / 10));
  const [sideClearanceCm, setSideClearanceCm] = useState(String(DEMO_ROOM.requiredHorizontalClearanceMm / 10));
  const [depthClearanceCm, setDepthClearanceCm] = useState(String(DEMO_ROOM.requiredDepthClearanceMm / 10));
  const [budget, setBudget] = useState("180");
  const [confirmed, setConfirmed] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [payments, setPayments] = useState<Record<string, PaymentView | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [payConsent, setPayConsent] = useState(false);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [visionPhase, setVisionPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [visionError, setVisionError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PlacementBox | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [requestText, setRequestText] = useState("Find a desk under $180 for this corner and leave 20 cm of clearance.");
  const [preferences, setPreferences] = useState<PreferenceView | null>(null);
  const [preferencePhase, setPreferencePhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [checkedSignature, setCheckedSignature] = useState<string | null>(null);

  const signature = useMemo(
    () =>
      JSON.stringify({
        widthCm,
        depthCm,
        sideClearanceCm,
        depthClearanceCm,
        budget,
        confirmed,
        placement,
      }),
    [widthCm, depthCm, sideClearanceCm, depthClearanceCm, budget, confirmed, placement],
  );
  const sceneDirty = checkedSignature !== null && checkedSignature !== signature;

  function measurementBody() {
    return {
      availableWidthMm: centimetersToMillimeters(widthCm),
      availableDepthMm: centimetersToMillimeters(depthCm),
      requiredHorizontalClearanceMm: centimetersToMillimeters(sideClearanceCm),
      requiredDepthClearanceMm: centimetersToMillimeters(depthClearanceCm),
      budgetMinor: parseUsdToMinor(budget),
      currency: "USD",
      confirmed,
      placement,
    };
  }

  async function analyzeFile(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setVisionPhase("error");
      setVisionError("Upload a JPEG or PNG.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setVisionPhase("error");
      setVisionError("That photograph is larger than 8 MB.");
      return;
    }
    setVisionPhase("loading");
    setVisionError(null);
    setAnalysis(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    const form = new FormData();
    form.set("image", file);
    try {
      const response = await fetch("/api/vision/analyze", { method: "POST", body: form });
      const body = (await response.json()) as AnalysisView;
      const inventedMeasurement = body.dimensions_mm !== null && body.dimensions_mm !== undefined;
      if (!response.ok || inventedMeasurement) {
        setVisionPhase("error");
        setVisionError(body.message ?? "The photograph could not be analyzed.");
        return;
      }
      setAnalysis(body);
      const first = body.placement_candidates?.[0];
      const box = first ? boxFromModel(first.bbox_normalized, first.label, "ai") : null;
      setPlacement(box);
      setDrawing(!box);
      setVisionPhase("done");
      setCheckedSignature(null);
    } catch {
      setVisionPhase("error");
      setVisionError("The vision service could not be reached.");
    }
  }

  async function useSample() {
    setVisionPhase("loading");
    setVisionError(null);
    const response = await fetch("/samples/room-01-corner.jpg");
    if (!response.ok) {
      setVisionPhase("error");
      setVisionError("The sample room diagram is missing.");
      return;
    }
    const blob = await response.blob();
    await analyzeFile(new File([blob], "room-01-corner.jpg", { type: "image/jpeg" }));
  }

  async function readRequest() {
    setPreferencePhase("loading");
    try {
      const response = await fetch("/api/vision/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText }),
      });
      const body = (await response.json()) as PreferenceView;
      if (!response.ok) {
        setPreferencePhase("error");
        setPreferences({ message: body.message ?? "The request could not be read." });
        return;
      }
      setPreferences(body);
      setPreferencePhase("done");
    } catch {
      setPreferencePhase("error");
      setPreferences({ message: "The vision service could not be reached." });
    }
  }

  function applyPreferences() {
    if (!preferences) return;
    if (typeof preferences.maximum_budget_minor === "number") {
      setBudget(String(preferences.maximum_budget_minor / 100));
    }
    if (typeof preferences.horizontal_clearance_mm === "number") {
      setSideClearanceCm(String(preferences.horizontal_clearance_mm / 10));
    }
    if (typeof preferences.depth_clearance_mm === "number") {
      setDepthClearanceCm(String(preferences.depth_clearance_mm / 10));
    }
    setConfirmed(false);
    setPayConsent(false);
  }

  async function checkFit(sku: string, roomOverride?: string | null) {
    setCards((current) => ({ ...current, [sku]: { phase: "loading" } }));
    setPayConsent(false);
    const activeRoom = roomOverride === undefined ? roomId : roomOverride;
    try {
      const response = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, roomId: activeRoom, ...measurementBody() }),
      });
      const body = (await response.json()) as AssessmentResponse & { message?: string };
      if (!body.result) {
        setCards((current) => ({
          ...current,
          [sku]: { phase: "error", error: body.message ?? "The fit check failed." },
        }));
        return activeRoom;
      }
      if (body.roomId) setRoomId(body.roomId);
      setCards((current) => ({ ...current, [sku]: { phase: "done", assessment: body } }));
      return body.roomId ?? activeRoom;
    } catch {
      setCards((current) => ({
        ...current,
        [sku]: { phase: "error", error: "The fit check could not reach the server." },
      }));
      return activeRoom;
    }
  }

  async function rankFromLatest(knownIds: string[]) {
    const ids = knownIds.length > 0 ? knownIds : [];
    if (ids.length === 0) return;
    try {
      const response = await fetch("/api/vision/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText, assessmentIds: ids }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { rankings?: RankNote[] };
      const next: Record<string, string> = {};
      for (const item of body.rankings ?? []) next[item.sku] = item.explanation;
      setNotes(next);
    } catch {
      setRoomNote("Explanations are unavailable. The geometry results are unchanged.");
    }
  }

  async function verifyAndExplain() {
    setBusy("verify");
    const usedSignature = signature;
    let nextRoom = roomId;
    const ids: string[] = [];
    for (const product of products) {
      setCards((current) => ({ ...current, [product.sku]: { phase: "loading" } }));
      try {
        const response = await fetch("/api/assessments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku: product.sku, roomId: nextRoom, ...measurementBody() }),
        });
        const body = (await response.json()) as AssessmentResponse & { message?: string };
        if (!body.result) {
          setCards((current) => ({
            ...current,
            [product.sku]: { phase: "error", error: body.message ?? "The fit check failed." },
          }));
          continue;
        }
        if (body.roomId) {
          nextRoom = body.roomId;
          setRoomId(body.roomId);
        }
        if (body.assessmentId) ids.push(body.assessmentId);
        setCards((current) => ({ ...current, [product.sku]: { phase: "done", assessment: body } }));
      } catch {
        setCards((current) => ({
          ...current,
          [product.sku]: { phase: "error", error: "The fit check could not reach the server." },
        }));
      }
    }
    setCheckedSignature(usedSignature);
    setPayConsent(false);
    setBusy(null);
    if (ids.length > 0) await rankFromLatest(ids);
  }

  async function saveRoom() {
    if (!roomId) return;
    setBusy("room");
    setRoomNote(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(measurementBody()),
      });
      const body = (await response.json()) as {
        version?: number;
        changed?: boolean;
        message?: string;
      };
      if (!response.ok) {
        setRoomNote(body.message ?? "The room could not be updated.");
        return;
      }
      setCheckedSignature(null);
      setPayConsent(false);
      setRoomNote(
        body.changed
          ? `Room version is now ${body.version}. Earlier fit assessments cannot capture a payment.`
          : `Room version is still ${body.version}. Nothing relevant changed.`,
      );
    } catch {
      setRoomNote("The room update could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function settle(sku: string, orderId: string, action: "capture" | "void") {
    setBusy(`${sku}:${action}`);
    try {
      const response = await fetch(`/api/paypal/orders/${encodeURIComponent(orderId)}/${action}`, { method: "POST" });
      const body = (await response.json()) as Partial<PaymentView> & { message?: string; code?: string };
      if (!isPaymentView(body)) {
        setPayments((current) => ({
          ...current,
          [sku]: {
            completed: false,
            ledgerStatus: "FAILED",
            displayStatus: "FAILED",
            providerStatus: body.code ?? "FAILED",
            orderId,
            authorizationId: current[sku]?.authorizationId ?? null,
            captureId: null,
            amountMinor: current[sku]?.amountMinor ?? 0,
            currency: "USD",
            message: body.message ?? "The payment action failed.",
          },
        }));
        return;
      }
      setPayments((current) => ({ ...current, [sku]: body }));
    } catch {
      setRoomNote("The payment action could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const selected = products.find((product) => product.sku === selectedSku) ?? null;
  const selectedCard = selected ? cards[selected.sku] : undefined;
  const selectedPayment = selected ? (payments[selected.sku] ?? null) : null;
  const catalogPrice = selectedCard?.assessment?.comparison.priceMinor ?? selected?.priceMinor ?? 0;
  const canOpenPayPal =
    !sceneDirty &&
    selectedCard?.assessment?.result === "FIT" &&
    typeof selectedCard.assessment.assessmentId === "string" &&
    payConsent &&
    paypal.ready &&
    Boolean(paypal.clientId) &&
    selectedPayment?.ledgerStatus !== "AUTHORIZED" &&
    selectedPayment?.displayStatus !== "CAPTURED" &&
    selectedPayment?.ledgerStatus !== "VOIDED";

  const results = Object.fromEntries(
    products.map((product) => [product.sku, cards[product.sku]?.assessment?.result]),
  );
  const catalog = selectCatalog(products, results, filter, selectedSku, showAll);
  const obstacles = (analysis?.visible_obstacles ?? [])
    .map((item) => boxFromModel(item.bbox_normalized, item.label, "ai"))
    .filter((item): item is PlacementBox => item !== null);
  const steps = journeySteps({
    hasPhoto: Boolean(imageUrl),
    measurementsConfirmed: confirmed,
    hasCurrentAssessment: checkedSignature !== null && !sceneDirty,
    paymentSettled: Object.values(payments).some(
      (payment) => payment?.displayStatus === "CAPTURED" || payment?.displayStatus === "VOIDED",
    ),
  });
  const closedReason = checkoutClosedReason({
    result: selectedCard?.assessment?.result ?? null,
    confirmed,
    sceneDirty,
    consented: payConsent,
  });
  const earlierPayments = Object.entries(payments).flatMap(([sku, payment]) =>
    payment && sku !== selected?.sku && (payment.displayStatus === "CAPTURED" || payment.displayStatus === "VOIDED")
      ? [{ sku, payment }]
      : [],
  );

  function focusReview(sku: string) {
    setSelectedSku(sku);
    window.requestAnimationFrame(() => document.getElementById("fit-review")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="space-y-8">
      <ol className="grid grid-cols-4 gap-2" aria-label="Purchase steps">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className={`rounded-xl border px-2 py-2 sm:px-3 ${
              step.state === "current" ? "border-teal bg-card" : "border-line bg-card/70"
            }`}
          >
            <p className="text-[11px] font-semibold tracking-[0.14em] text-teal uppercase">{index + 1}</p>
            <p className="text-sm font-medium sm:text-base">{step.label}</p>
            <p className="text-xs text-ink/55">{step.state === "done" ? "Done" : step.state === "current" ? "Now" : "Waiting"}</p>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
        <section className="rounded-3xl border border-line bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-3xl">Your room</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-ink/70">
                The photo can suggest a desk area. You still enter the centimeters. Nothing in the picture becomes a measurement.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-teal px-4 text-sm font-medium text-white">
                Upload photo
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void analyzeFile(file);
                  }}
                />
              </label>
              <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => void useSample()}>
                Sample room
              </button>
              <button
                type="button"
                className="min-h-11 rounded-full border border-line px-4 text-sm"
                onClick={() => {
                  setPlacement(null);
                  setDrawing(true);
                }}
              >
                Draw area
              </button>
            </div>
          </div>
          {visionPhase === "loading" ? <p className="mt-3 text-sm text-ink/70">Reading the photograph. No measurement is being inferred.</p> : null}
          {visionError ? <p className="mt-3 text-sm text-nofit">{visionError}</p> : null}
          <div className="mt-4">
            <PlacementEditor
              imageUrl={imageUrl}
              box={placement}
              obstacles={obstacles}
              drawing={drawing}
              measurementLabel={
                confirmed
                  ? `Entered by you: ${widthCm || "?"} cm wide, ${depthCm || "?"} cm deep`
                  : "Measurements are not confirmed"
              }
              onDrawingChange={setDrawing}
              onBoxChange={(box) =>
                setPlacement({
                  ...box,
                  label: placement?.label ?? "Desk placement area",
                  source: "buyer",
                })
              }
            />
          </div>
          {analysis?.room_description ? <p className="mt-4 text-sm leading-6">{analysis.room_description}</p> : null}
          {analysis?.placement_candidates && analysis.placement_candidates.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {analysis.placement_candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="rounded-full border border-line px-3 py-2 text-sm"
                  onClick={() => {
                    const box = boxFromModel(candidate.bbox_normalized, candidate.label, "ai");
                    if (box) setPlacement(box);
                  }}
                >
                  {candidate.label} · {Math.round(candidate.confidence * 100)}%
                </button>
              ))}
            </div>
          ) : visionPhase === "done" ? (
            <p className="mt-3 text-sm text-uncertain">No placement region was proposed. Draw the desk area on the photo.</p>
          ) : null}
          {analysis?.warnings?.slice(0, 2).map((warning) => (
            <p key={warning} className="mt-2 text-sm leading-6 text-ink/65">
              {warning}
            </p>
          ))}
          {analysis?.measurement_questions?.slice(0, 2).map((question) => (
            <p key={question} className="mt-2 text-sm leading-6 text-ink/65">
              Still to measure: {question}
            </p>
          ))}
        </section>

        <section id="measurements" className="space-y-4">
          <form className="rounded-3xl border border-line bg-card p-4 sm:p-5" onSubmit={(event) => event.preventDefault()}>
            <h2 className="font-display text-3xl">The space</h2>
            <p className="mt-1 text-sm leading-6 text-ink/70">Whole centimeters. Clearance is added to the desk before the fit check.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => setWidthCm("100")}>
                100 cm room
              </button>
              <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => setWidthCm("150")}>
                150 cm room
              </button>
            </div>
            <div className="mt-3 grid gap-3">
              <Field id="room-width" label="Available width" suffix="cm" value={widthCm} onChange={setWidthCm} />
              <Field id="room-depth" label="Available depth" suffix="cm" value={depthCm} onChange={setDepthCm} />
              <Field id="side-clearance" label="Side clearance" suffix="cm" value={sideClearanceCm} onChange={setSideClearanceCm} />
              <Field id="depth-clearance" label="Depth clearance" suffix="cm" value={depthClearanceCm} onChange={setDepthClearanceCm} />
              <Field id="room-budget" label="Maximum budget" suffix="USD" value={budget} onChange={setBudget} />
            </div>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>I confirm these measurements. The photograph is not the source of the centimeters.</span>
            </label>
            {sceneDirty ? <p className="mt-3 text-sm leading-6 text-uncertain">{STALE_ASSESSMENT_NOTICE}</p> : null}
            {roomNote ? <p className="mt-3 text-sm leading-6">{roomNote}</p> : null}
            <button
              type="button"
              className="mt-4 min-h-11 w-full rounded-full bg-teal px-4 text-sm font-medium text-white disabled:opacity-60"
              disabled={busy !== null}
              onClick={() => void verifyAndExplain()}
            >
              {busy === "verify" ? "Checking desks…" : "Find compatible desks"}
            </button>
            <button
              type="button"
              className="mt-2 min-h-11 w-full rounded-full border border-line px-4 text-sm disabled:opacity-60"
              disabled={!roomId || busy !== null}
              onClick={() => void saveRoom()}
            >
              {busy === "room" ? "Saving scene…" : "Save corrected measurements"}
            </button>
          </form>

          <div className="rounded-3xl border border-line bg-card p-4 sm:p-5">
            <h2 className="font-display text-2xl">Shopping request</h2>
            <label htmlFor="shopping-request" className="mt-3 block text-sm">
              Describe the desk
              <textarea
                id="shopping-request"
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-xl border border-line bg-paper px-3 py-3 text-base"
              />
            </label>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-full border border-line px-4 text-sm disabled:opacity-60"
              disabled={preferencePhase === "loading"}
              onClick={() => void readRequest()}
            >
              {preferencePhase === "loading" ? "Reading request…" : "Read request"}
            </button>
            {preferences?.message ? <p className="mt-3 text-sm text-nofit">{preferences.message}</p> : null}
            {preferencePhase === "done" && preferences ? (
              <div className="mt-3 space-y-2 text-sm leading-6">
                <p>Category: {preferences.product_category}</p>
                <p>
                  Budget:{" "}
                  {typeof preferences.maximum_budget_minor === "number" ? formatUsd(preferences.maximum_budget_minor) : "not stated"}
                </p>
                <p>
                  Clearance:{" "}
                  {typeof preferences.horizontal_clearance_mm === "number"
                    ? `${preferences.horizontal_clearance_mm / 10} cm side`
                    : "side not stated"}
                  {typeof preferences.depth_clearance_mm === "number"
                    ? `, ${preferences.depth_clearance_mm / 10} cm depth`
                    : ", depth not stated"}
                </p>
                {preferences.unresolved_questions?.map((question) => (
                  <p key={question}>Still open: {question}</p>
                ))}
                {preferences.warnings?.slice(0, 2).map((warning) => (
                  <p key={warning} className="text-ink/65">
                    {warning}
                  </p>
                ))}
                <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={applyPreferences}>
                  Use these constraints
                </button>
                <p className="text-xs leading-5 text-ink/55">Applying a request clears confirmation. It does not set a PayPal amount.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl">Desks</h2>
            <p className="mt-1 text-sm text-ink/65">
              {catalog.hidden > 0 ? `Showing the closest matches. ${catalog.hidden} more are hidden.` : "Compare size, price, and the server fit result."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "FIT", "DOES_NOT_FIT", "UNCERTAIN"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`min-h-11 rounded-full border px-3 text-sm ${filter === item ? "border-teal bg-teal text-white" : "border-line bg-card"}`}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "DOES_NOT_FIT" ? "Does not fit" : item === "UNCERTAIN" ? "Uncertain" : "Fits"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.shown.map((product) => {
            const card = cards[product.sku];
            return (
              <ProductCard
                key={product.sku}
                title={product.title}
                sku={product.sku}
                widthMm={product.widthMm}
                depthMm={product.depthMm}
                priceMinor={product.priceMinor}
                result={card?.assessment?.result}
                explanation={
                  card?.phase === "error"
                    ? (card.error ?? "The fit check failed.")
                    : card?.assessment
                      ? (notes[product.sku] ?? verdict(card.assessment.result).summary)
                      : "Not checked yet."
                }
                selected={selectedSku === product.sku}
                loading={card?.phase === "loading"}
                onSelect={() => {
                  setSelectedSku(product.sku);
                  void checkFit(product.sku);
                  setCheckedSignature(signature);
                  focusReview(product.sku);
                }}
                onDetails={() => focusReview(product.sku)}
              />
            );
          })}
        </div>
        {catalog.shown.length === 0 ? <p className="mt-4 text-sm text-ink/70">No desks match this filter yet.</p> : null}
        {catalog.hidden > 0 ? (
          <button type="button" className="mt-4 min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => setShowAll(true)}>
            View all desks
          </button>
        ) : showAll && filter === "all" ? (
          <button type="button" className="mt-4 min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => setShowAll(false)}>
            Show fewer desks
          </button>
        ) : null}
      </section>

      <section id="fit-review" className="scroll-mt-6 rounded-3xl border border-line bg-card p-4 sm:p-5">
        {!selected || !selectedCard?.assessment ? (
          <div>
            <h2 className="font-display text-3xl">Review</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/75">
              Select a desk. The fit decision and PayPal checkout appear here, using the price and result from the server.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
            <div>
              <p className="text-sm text-ink/60">{selected.title}</p>
              <h2 className="font-display text-3xl">Fit evidence</h2>
              <div className="mt-4">
                <FitResult assessment={selectedCard.assessment} />
              </div>
            </div>
            <div>
              <h2 className="font-display text-3xl">Approve payment</h2>
              <p className="mt-2 text-sm text-ink/70">Catalog price {formatUsd(catalogPrice)}</p>
              {sceneDirty ? <p className="mt-3 text-sm leading-6 text-uncertain">{STALE_ASSESSMENT_NOTICE}</p> : null}
              {selectedCard.assessment.result === "FIT" && selectedCard.assessment.assessmentId ? (
                paypal.ready && paypal.clientId ? (
                  <>
                    <label className="mt-4 flex items-start gap-3 text-sm leading-6">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={payConsent}
                        onChange={(event) => setPayConsent(event.target.checked)}
                      />
                      <span>
                        I approve a PayPal Sandbox authorization for {formatUsd(catalogPrice)} on {selected.title}. The
                        catalog price is the only amount that can be authorized. An authorization is not a completed payment.
                      </span>
                    </label>
                    {canOpenPayPal ? (
                      <div className="mt-4">
                        <PayPalCheckout
                          assessmentId={selectedCard.assessment.assessmentId}
                          clientId={paypal.clientId}
                          onAuthorized={(next) => setPayments((current) => ({ ...current, [selected.sku]: next }))}
                        />
                      </div>
                    ) : selectedPayment ? null : (
                      <p className="mt-3 text-sm text-ink/70">{closedReason}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-sm leading-6">{paypal.message}</p>
                )
              ) : (
                <div className="mt-4 rounded-2xl border border-nofit/30 bg-nofit/10 p-4 text-sm leading-6 text-nofit">
                  <p>{closedReason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href="#measurements" className="inline-flex min-h-11 items-center rounded-full border border-current px-4">
                      Correct measurements
                    </a>
                    <button type="button" className="min-h-11 rounded-full border border-current px-4" onClick={() => setShowAll(true)}>
                      Choose another desk
                    </button>
                  </div>
                </div>
              )}
              {selectedPayment ? (
                <div className="mt-4">
                  <PaymentStatus
                    payment={selectedPayment}
                    busy={busy}
                    sku={selected.sku}
                    onCapture={() => void settle(selected.sku, selectedPayment.orderId, "capture")}
                    onVoid={() => void settle(selected.sku, selectedPayment.orderId, "void")}
                    onSaveRoom={() => void saveRoom()}
                  />
                </div>
              ) : null}
              {earlierPayments.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {earlierPayments.map((item) => (
                    <PaymentStatus
                      key={item.payment.orderId}
                      payment={item.payment}
                      busy={busy}
                      sku={item.sku}
                      historical
                      onCapture={() => undefined}
                      onVoid={() => undefined}
                      onSaveRoom={() => undefined}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}


function Field({
  id,
  label,
  suffix,
  value,
  onChange,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block text-base">
      <span className="mb-1 flex justify-between">
        <span>{label}</span>
        <span className="text-ink/50">{suffix}</span>
      </span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-line bg-paper px-3 py-2"
      />
    </label>
  );
}

function boxFromModel(bbox: number[] | null | undefined, label: string, source: "ai" | "buyer"): PlacementBox | null {
  if (!bbox || bbox.length !== 4 || bbox.some((value) => typeof value !== "number" || value < 0 || value > 1)) return null;
  const [minX, minY, maxX, maxY] = bbox;
  if (maxX - minX < 0.01 || maxY - minY < 0.01) return null;
  return { minX, minY, maxX, maxY, label, source };
}

function centimetersToMillimeters(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const centimeters = Number(trimmed);
  if (!Number.isSafeInteger(centimeters)) return null;
  const millimeters = centimeters * 10;
  return Number.isSafeInteger(millimeters) ? millimeters : null;
}

function isPaymentView(value: Partial<PaymentView>): value is PaymentView {
  return (
    typeof value.completed === "boolean" &&
    typeof value.ledgerStatus === "string" &&
    typeof value.displayStatus === "string" &&
    typeof value.providerStatus === "string" &&
    typeof value.orderId === "string" &&
    typeof value.amountMinor === "number" &&
    typeof value.currency === "string" &&
    typeof value.message === "string" &&
    (value.authorizationId === null || typeof value.authorizationId === "string") &&
    (value.captureId === null || typeof value.captureId === "string")
  );
}
