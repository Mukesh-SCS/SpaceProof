"use client";

import { useMemo, useState } from "react";
import type { AssessmentResponse, PaymentView } from "@/lib/api-types";
import { DEMO_ROOM } from "@/lib/demo-scenario";
import type { CatalogProduct } from "@/lib/geometry/fit";
import { formatUsd, parseUsdToMinor } from "@/lib/money";
import type { PlacementBox } from "@/lib/scene";
import { FitResult } from "@/components/fit-result";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { PlacementEditor, type NormBox } from "@/components/placement-editor";

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

const paymentTones: Record<string, string> = {
  AUTHORIZED: "border-authorized/30 bg-authorized/10 text-authorized",
  CAPTURED: "border-captured/30 bg-captured/10 text-captured",
  VOIDED: "border-voided/30 bg-voided/10 text-voided",
  FAILED: "border-nofit/30 bg-nofit/10 text-nofit",
  CANCELED: "border-uncertain/30 bg-uncertain/10 text-uncertain",
  PENDING: "border-line bg-paper text-ink",
  CREATED: "border-line bg-paper text-ink",
};

const resultTone: Record<string, string> = {
  FIT: "bg-fit/10 text-fit",
  DOES_NOT_FIT: "bg-nofit/10 text-nofit",
  UNCERTAIN: "bg-uncertain/15 text-uncertain",
};

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
  const [filter, setFilter] = useState<"all" | "FIT" | "DOES_NOT_FIT" | "UNCERTAIN">("all");
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
    setPayments((current) => ({ ...current, [sku]: null }));
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

  const visible = products.filter((product) => {
    if (filter === "all") return true;
    return cards[product.sku]?.assessment?.result === filter;
  });
  const obstacles = (analysis?.visible_obstacles ?? [])
    .map((item) => boxFromModel(item.bbox_normalized, item.label, "ai"))
    .filter((item): item is PlacementBox => item !== null);

  const steps = [
    { n: "1", label: "Upload space", done: Boolean(imageUrl) },
    { n: "2", label: "Confirm measurements", done: confirmed && checkedSignature !== null },
    { n: "3", label: "Verify products", done: Object.values(cards).some((card) => card.assessment) },
    {
      n: "4",
      label: "Approve payment",
      done: Object.values(payments).some((payment) => payment?.ledgerStatus === "AUTHORIZED" || payment?.displayStatus === "CAPTURED"),
    },
  ];

  return (
    <div className="space-y-6">
      <ol className="grid gap-2 sm:grid-cols-4">
        {steps.map((step) => (
          <li key={step.n} className="rounded-xl border border-line bg-card px-3 py-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-teal uppercase">Step {step.n}</p>
            <p className="mt-1 text-base font-medium">{step.label}</p>
            <p className="text-sm text-ink/60">{step.done ? "Ready" : "Waiting"}</p>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section className="space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
          <div>
            <h2 className="font-display text-3xl">Upload space</h2>
            <p className="mt-2 text-base leading-7 text-ink/75">
              A photograph can suggest where a desk might go. You still enter the width, depth, clearance, and budget.
              Unconfirmed measurements stay uncertain, and checkout stays closed.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-teal px-4 text-sm font-medium text-white">
              Upload JPEG or PNG
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
              Use sample diagram
            </button>
            <button
              type="button"
              className="min-h-11 rounded-full border border-line px-4 text-sm"
              onClick={() => {
                setPlacement(null);
                setDrawing(true);
              }}
            >
              Draw my own region
            </button>
          </div>
          {visionPhase === "loading" ? <p className="text-base text-ink/70">Reading the photograph. No measurement is being inferred.</p> : null}
          {visionError ? <p className="text-base text-nofit">{visionError}</p> : null}
          <PlacementEditor
            imageUrl={imageUrl}
            box={placement}
            obstacles={obstacles}
            drawing={drawing}
            onDrawingChange={setDrawing}
            onBoxChange={(box) =>
              setPlacement({
                ...box,
                label: placement?.label ?? "Desk placement area",
                source: "buyer",
              })
            }
          />
          {analysis?.room_description ? <p className="text-base leading-7">{analysis.room_description}</p> : null}
          {analysis?.placement_candidates && analysis.placement_candidates.length > 0 ? (
            <div className="flex flex-wrap gap-2">
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
            <p className="text-base text-uncertain">No placement region was proposed. Draw the desk area on the photo.</p>
          ) : null}
          {analysis?.warnings?.map((warning) => (
            <p key={warning} className="text-sm leading-6 text-ink/70">
              {warning}
            </p>
          ))}
          {analysis?.measurement_questions?.map((question) => (
            <p key={question} className="text-sm leading-6 text-ink/70">
              Ask: {question}
            </p>
          ))}

          <form className="space-y-3 border-t border-line pt-4" onSubmit={(event) => event.preventDefault()}>
            <h3 className="font-display text-2xl">Confirm measurements</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => setWidthCm("100")}>
                100 cm room
              </button>
              <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => setWidthCm("150")}>
                150 cm room
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="room-width" label="Available width" suffix="cm" value={widthCm} onChange={setWidthCm} />
              <Field id="room-depth" label="Available depth" suffix="cm" value={depthCm} onChange={setDepthCm} />
              <Field id="side-clearance" label="Side clearance" suffix="cm" value={sideClearanceCm} onChange={setSideClearanceCm} />
              <Field id="depth-clearance" label="Depth clearance" suffix="cm" value={depthClearanceCm} onChange={setDepthClearanceCm} />
              <Field id="room-budget" label="Maximum budget" suffix="USD" value={budget} onChange={setBudget} />
            </div>
            <p className="text-sm leading-6 text-ink/70">
              Stored size: {millimeterHint(widthCm)} wide and {millimeterHint(depthCm)} deep. Side clearance is added to
              the desk width. Depth clearance is added to the desk depth.
              {placement
                ? ` Placement covers ${Math.round((placement.maxX - placement.minX) * 100)}% of the photo width.`
                : " No placement rectangle is saved yet."}
            </p>
            <label className="flex items-start gap-3 text-base">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>I confirm these measurements. The photograph is not the source of the centimeters.</span>
            </label>
            <button
              type="button"
              className="min-h-11 rounded-full border border-line px-4 text-sm disabled:opacity-60"
              disabled={!roomId || busy !== null}
              onClick={() => void saveRoom()}
            >
              {busy === "room" ? "Saving scene…" : "Save corrected measurements"}
            </button>
            {roomNote ? <p className="text-base leading-7">{roomNote}</p> : null}
            {sceneDirty ? (
              <p className="text-base text-uncertain">
                The room or placement changed after the last check. Verify the desks again before payment.
              </p>
            ) : null}
          </form>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <h2 className="font-display text-3xl">Shopping request</h2>
            <label htmlFor="shopping-request" className="mt-3 block text-base">
              Describe the desk
              <textarea
                id="shopping-request"
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border border-line bg-paper px-3 py-3 text-base"
              />
            </label>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-full bg-ink px-4 text-sm font-medium text-paper disabled:opacity-60"
              disabled={preferencePhase === "loading"}
              onClick={() => void readRequest()}
            >
              {preferencePhase === "loading" ? "Reading request…" : "Read request"}
            </button>
            {preferences?.message ? <p className="mt-3 text-base text-nofit">{preferences.message}</p> : null}
            {preferencePhase === "done" && preferences ? (
              <div className="mt-4 space-y-2 text-base leading-7">
                <p>Category: {preferences.product_category}</p>
                <p>
                  Budget:{" "}
                  {typeof preferences.maximum_budget_minor === "number"
                    ? formatUsd(preferences.maximum_budget_minor)
                    : "not stated"}
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
                {preferences.style_preferences && preferences.style_preferences.length > 0 ? (
                  <p>Style: {preferences.style_preferences.join(", ")}</p>
                ) : null}
                {preferences.unresolved_questions?.map((question) => (
                  <p key={question}>Still open: {question}</p>
                ))}
                {preferences.warnings?.map((warning) => (
                  <p key={warning} className="text-ink/70">
                    {warning}
                  </p>
                ))}
                <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={applyPreferences}>
                  Use these constraints
                </button>
                <p className="text-sm leading-6 text-ink/60">
                  Applying a request clears measurement confirmation. It does not set a PayPal amount.
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-display text-3xl">Verify products</h2>
              <button
                type="button"
                className="min-h-11 rounded-full bg-teal px-4 text-sm font-medium text-white disabled:opacity-60"
                disabled={busy !== null}
                onClick={() => void verifyAndExplain()}
              >
                {busy === "verify" ? "Checking desks…" : "Verify all desks"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["all", "FIT", "DOES_NOT_FIT", "UNCERTAIN"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`rounded-full border px-3 py-2 text-sm ${filter === item ? "border-teal text-teal" : "border-line"}`}
                  onClick={() => setFilter(item)}
                >
                  {item === "all" ? "All" : item === "DOES_NOT_FIT" ? "Does not fit" : item === "UNCERTAIN" ? "Uncertain" : "Fit"}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3">
              {visible.map((product) => {
                const card = cards[product.sku];
                const result = card?.assessment?.result;
                return (
                  <article
                    key={product.sku}
                    className={`rounded-xl border p-4 ${selectedSku === product.sku ? "border-teal" : "border-line"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-2xl">{product.title}</h3>
                        <p className="text-sm text-ink/60">
                          {product.sku} · {formatLength(product.widthMm)} wide · {formatLength(product.depthMm)} deep ·{" "}
                          {formatUsd(product.priceMinor)}
                        </p>
                      </div>
                      {result ? (
                        <p className={`rounded-full px-3 py-1 text-sm font-semibold ${resultTone[result]}`}>
                          {result === "DOES_NOT_FIT" ? "DOES NOT FIT" : result}
                        </p>
                      ) : (
                        <p className="text-sm text-ink/50">Not checked</p>
                      )}
                    </div>
                    {card?.phase === "error" ? <p className="mt-2 text-base text-nofit">{card.error}</p> : null}
                    {notes[product.sku] ? <p className="mt-2 text-base leading-7">{notes[product.sku]}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="min-h-11 rounded-full border border-line px-4 text-sm"
                        onClick={() => {
                          setSelectedSku(product.sku);
                          void checkFit(product.sku);
                          setCheckedSignature(signature);
                        }}
                      >
                        {card?.phase === "loading" ? "Checking…" : "Check fit"}
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-full border border-line px-4 text-sm"
                        onClick={() => setSelectedSku(product.sku)}
                      >
                        Review
                      </button>
                    </div>
                    {selectedSku === product.sku && card?.assessment ? <FitResult assessment={card.assessment} /> : null}
                  </article>
                );
              })}
              {visible.length === 0 ? <p className="text-base text-ink/70">No desks match this filter yet.</p> : null}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
        <h2 className="font-display text-3xl">Approve payment</h2>
        {!selected || !selectedCard?.assessment ? (
          <p className="mt-3 text-base leading-7 text-ink/75">
            Choose a desk and check the fit. PayPal opens only after the server records FIT and you approve the catalog
            price.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-2 text-base leading-7">
              <p className="font-display text-2xl">{selected.title}</p>
              <p>SKU {selected.sku}</p>
              <p>Catalog price {formatUsd(catalogPrice)}</p>
              <p>
                Result {selectedCard.assessment.result}
                {selectedCard.assessment.measurementVersion !== null
                  ? ` · room version ${selectedCard.assessment.measurementVersion}`
                  : ""}
              </p>
              <p>{selectedCard.assessment.explanation}</p>
              {selectedCard.assessment.result !== "FIT" ? (
                <p className="text-nofit">Checkout stays closed. The server will not create a PayPal order for this result.</p>
              ) : null}
            </div>
            <div>
              {selectedCard.assessment.result === "FIT" && selectedCard.assessment.assessmentId ? (
                paypal.ready && paypal.clientId ? (
                  <>
                    <label className="flex items-start gap-3 text-base">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={payConsent}
                        onChange={(event) => setPayConsent(event.target.checked)}
                      />
                      <span>
                        I approve a PayPal Sandbox authorization for {formatUsd(catalogPrice)} on {selected.title}. The
                        catalog price is the only amount that can be authorized. No real money moves. An authorization
                        is not a completed payment.
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
                      <p className="mt-3 text-base text-ink/70">Confirm the catalog price to open PayPal.</p>
                    )}
                  </>
                ) : (
                  <p className="text-base leading-7">{paypal.message}</p>
                )
              ) : null}
              {selectedPayment ? (
                <PaymentPanel
                  payment={selectedPayment}
                  busy={busy}
                  sku={selected.sku}
                  onCapture={() => void settle(selected.sku, selectedPayment.orderId, "capture")}
                  onVoid={() => void settle(selected.sku, selectedPayment.orderId, "void")}
                  onSaveRoom={() => void saveRoom()}
                />
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PaymentPanel({
  payment,
  busy,
  sku,
  onCapture,
  onVoid,
  onSaveRoom,
}: {
  payment: PaymentView;
  busy: string | null;
  sku: string;
  onCapture: () => void;
  onVoid: () => void;
  onSaveRoom: () => void;
}) {
  const tone = paymentTones[payment.displayStatus] ?? paymentTones.PENDING;
  const captured = payment.completed === true && payment.displayStatus === "CAPTURED" && Boolean(payment.captureId);
  const authorized = payment.ledgerStatus === "AUTHORIZED" && payment.completed !== true;
  return (
    <div className={`mt-4 rounded-xl border p-4 text-base ${tone}`}>
      <p className="font-semibold tracking-wide">{captured ? "CAPTURED" : payment.displayStatus}</p>
      <p className="mt-1 leading-7">{payment.message}</p>
      <p className="mt-2">Amount {formatUsd(payment.amountMinor)}</p>
      <p>PayPal order {payment.orderId}</p>
      {payment.authorizationId ? <p>Authorization {payment.authorizationId}</p> : null}
      {captured && payment.captureId ? <p>Capture {payment.captureId}</p> : null}
      {authorized ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-full bg-ink px-4 text-sm text-paper" disabled={busy !== null} onClick={onCapture}>
            {busy === `${sku}:capture` ? "Checking, then capturing…" : "Capture payment"}
          </button>
          <button type="button" className="min-h-11 rounded-full border border-current px-4 text-sm" disabled={busy !== null} onClick={onSaveRoom}>
            Save corrected room
          </button>
          <button type="button" className="min-h-11 rounded-full border border-current px-4 text-sm" disabled={busy !== null} onClick={onVoid}>
            {busy === `${sku}:void` ? "Voiding…" : "Void authorization"}
          </button>
        </div>
      ) : null}
      {authorized ? (
        <p className="mt-3 text-sm leading-6">
          To block a purchase, change the room width to 100 cm, save the corrected room, then capture. SpaceProof
          rechecks the assessment and voids the authorization if the desk no longer fits.
        </p>
      ) : null}
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

function millimeterHint(value: string): string {
  const millimeters = centimetersToMillimeters(value);
  return millimeters === null ? "invalid" : `${millimeters} mm`;
}

function formatLength(millimeters: number): string {
  return millimeters % 10 === 0 ? `${millimeters / 10} cm` : `${millimeters} mm`;
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
