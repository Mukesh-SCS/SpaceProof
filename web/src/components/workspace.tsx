"use client";

import { useMemo, useRef, useState } from "react";
import type { AssessmentResponse, PaymentView } from "@/lib/api-types";
import { DEMO_ROOM, SCENARIO_A_WIDTH_MM, SCENARIO_B_WIDTH_MM } from "@/lib/demo-scenario";
import {
  clearanceFieldsFromMillimeters,
  editClearance,
  editLength,
  inchesLabel,
  lengthFieldsFromMillimeters,
  lengthLabel,
  type ClearanceFields,
  type LengthFields,
} from "@/lib/imperial";
import type { CatalogProduct } from "@/lib/geometry/fit";
import { formatUsd, parseUsdToMinor } from "@/lib/money";
import type { PlacementBox } from "@/lib/scene";
import {
  assessmentIsCurrent,
  checkoutMayOpen,
  confirmationStatement,
  retainPaymentHistory,
  sceneReplacement,
  sceneSignature,
  versionsAreConsistent,
  type AssessmentStamp,
} from "@/lib/scene-freshness";
import {
  checkoutClosedReason,
  purchaseStages,
  selectCatalog,
  STALE_ASSESSMENT_NOTICE,
  verdict,
  type CatalogFilter,
  type CategoryFilter,
} from "@/components/experience";
import { FitPass } from "@/components/fit-pass";
import { PaymentStatus } from "@/components/payment-status";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { PlacementEditor } from "@/components/placement-editor";
import type { EditorTool } from "@/lib/placement-session";
import {
  confirmMeasurements,
  editMeasurement,
  measurementsForImage,
  provenanceLabel,
  type MeasurementProvenance,
} from "@/lib/measurement-provenance";
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
  const [width, setWidth] = useState<LengthFields>(() => lengthFieldsFromMillimeters(DEMO_ROOM.availableWidthMm));
  const [depth, setDepth] = useState<LengthFields>(() => lengthFieldsFromMillimeters(DEMO_ROOM.availableDepthMm));
  const [sideClearance, setSideClearance] = useState<ClearanceFields>(() =>
    clearanceFieldsFromMillimeters(DEMO_ROOM.requiredHorizontalClearanceMm),
  );
  const [depthClearance, setDepthClearance] = useState<ClearanceFields>(() =>
    clearanceFieldsFromMillimeters(DEMO_ROOM.requiredDepthClearanceMm),
  );
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
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageToken, setImageToken] = useState("none");
  const [constraintEpoch, setConstraintEpoch] = useState(0);
  const [stamps, setStamps] = useState<Record<string, AssessmentStamp | null>>({});
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [visionPhase, setVisionPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [visionError, setVisionError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PlacementBox | null>(null);
  const [aiPlacement, setAiPlacement] = useState<PlacementBox | null>(null);
  const [tool, setTool] = useState<EditorTool>("move");
  const [areaConfirmed, setAreaConfirmed] = useState(false);
  const [provenance, setProvenance] = useState<MeasurementProvenance>("demo_preset");
  const analysisRequest = useRef(0);
  const manualEdit = useRef(false);
  const currentFile = useRef<File | null>(null);
  const [requestText, setRequestText] = useState("Find a desk under $180 for this corner and leave 8 in of clearance.");
  const [preferences, setPreferences] = useState<PreferenceView | null>(null);
  const [preferencePhase, setPreferencePhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const signature = useMemo(
    () =>
      sceneSignature({
        imageToken,
        widthMm: width.mm,
        depthMm: depth.mm,
        sideClearanceMm: sideClearance.mm,
        depthClearanceMm: depthClearance.mm,
        budget,
        confirmed,
        placement,
        constraintEpoch,
      }),
    [imageToken, width, depth, sideClearance, depthClearance, budget, confirmed, placement, constraintEpoch],
  );
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const sceneStale = Object.values(stamps).some((stamp) => stamp && !assessmentIsCurrent(stamp, signature));

  function measurementBody() {
    return {
      availableWidthMm: width.mm,
      availableDepthMm: depth.mm,
      requiredHorizontalClearanceMm: sideClearance.mm,
      requiredDepthClearanceMm: depthClearance.mm,
      budgetMinor: parseUsdToMinor(budget),
      currency: "USD",
      confirmed,
      placement,
    };
  }

  function applyMeasurementDraft(kind: "sample" | "photo") {
    const draft = measurementsForImage(kind);
    setWidth(lengthFieldsFromMillimeters(draft.widthMm));
    setDepth(lengthFieldsFromMillimeters(draft.depthMm));
    setSideClearance(clearanceFieldsFromMillimeters(draft.sideClearanceMm));
    setDepthClearance(clearanceFieldsFromMillimeters(draft.depthClearanceMm));
    setBudget(draft.budget);
    setProvenance(draft.provenance);
    setConfirmed(draft.confirmed);
  }

  async function requestSuggestion(file: File, requestId: number) {
    const form = new FormData();
    form.set("image", file);
    try {
      const response = await fetch("/api/vision/analyze", { method: "POST", body: form });
      const body = (await response.json()) as AnalysisView;
      if (requestId !== analysisRequest.current) return;
      const inventedMeasurement = body.dimensions_mm !== null && body.dimensions_mm !== undefined;
      if (!response.ok || inventedMeasurement) {
        setVisionPhase("error");
        setVisionError("AI suggestion unavailable. You can draw the area manually.");
        setTool("draw");
        return;
      }
      setAnalysis(body);
      const first = body.placement_candidates?.[0];
      const box = first ? boxFromModel(first.bbox_normalized, first.label, "ai") : null;
      setAiPlacement(box);
      if (manualEdit.current) {
        setVisionPhase("done");
        return;
      }
      setPlacement(box);
      setAreaConfirmed(false);
      setTool(box ? "move" : "draw");
      setVisionPhase(box ? "done" : "error");
      if (!box) setVisionError("AI suggestion unavailable. You can draw the area manually.");
    } catch {
      if (requestId !== analysisRequest.current) return;
      setVisionPhase("error");
      setVisionError("AI suggestion unavailable. You can draw the area manually.");
      setTool("draw");
    }
  }

  async function analyzeFile(file: File, kind: "sample" | "photo") {
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
    const requestId = ++analysisRequest.current;
    manualEdit.current = false;
    currentFile.current = file;
    setVisionPhase("loading");
    setVisionError(null);
    setAnalysis(null);
    const reset = sceneReplacement();
    setConfirmed(reset.confirmed);
    setPayConsent(reset.consent);
    setAreaConfirmed(false);
    setImageToken(`photo-${crypto.randomUUID()}`);
    setPlacement(null);
    setAiPlacement(null);
    setTool("draw");
    applyMeasurementDraft(kind);
    setPayments((current) => retainPaymentHistory(current));
    if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    await requestSuggestion(file, requestId);
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
    await analyzeFile(new File([blob], "room-01-corner.jpg", { type: "image/jpeg" }), "sample");
  }

  async function suggestAgain() {
    const file = currentFile.current;
    if (!file) {
      setVisionError("Upload a room photo before asking for a suggestion.");
      return;
    }
    const requestId = ++analysisRequest.current;
    manualEdit.current = false;
    setVisionPhase("loading");
    setVisionError(null);
    await requestSuggestion(file, requestId);
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
      setSideClearance(clearanceFieldsFromMillimeters(preferences.horizontal_clearance_mm));
    }
    if (typeof preferences.depth_clearance_mm === "number") {
      setDepthClearance(clearanceFieldsFromMillimeters(preferences.depth_clearance_mm));
    }
    setConfirmed(false);
    setPayConsent(false);
  }

  function stampFor(sku: string, used: string, body: AssessmentResponse): AssessmentStamp | null {
    if (!body.assessmentId || !body.roomId || !body.policyFingerprint || body.measurementVersion === null) return null;
    if (body.comparison.priceMinor === null) return null;
    return {
      sceneSignature: used,
      roomId: body.roomId,
      measurementVersion: body.measurementVersion,
      policyFingerprint: body.policyFingerprint,
      sku,
      priceMinor: body.comparison.priceMinor,
      result: body.result,
    };
  }

  async function checkFit(sku: string, roomOverride?: string | null) {
    const used = signatureRef.current;
    const payload = { sku, roomId: roomOverride === undefined ? roomId : roomOverride, ...measurementBody() };
    setCards((current) => ({ ...current, [sku]: { phase: "loading", assessment: current[sku]?.assessment } }));
    setPayConsent(false);
    try {
      const response = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as AssessmentResponse & { message?: string };
      if (signatureRef.current !== used) {
        setCards((current) => ({ ...current, [sku]: current[sku]?.phase === "loading" ? { phase: "idle" } : current[sku] }));
        return payload.roomId;
      }
      if (!body.result) {
        setCards((current) => ({
          ...current,
          [sku]: { phase: "error", error: body.message ?? "The fit check failed." },
        }));
        return payload.roomId;
      }
      if (body.roomId) setRoomId(body.roomId);
      setCards((current) => ({ ...current, [sku]: { phase: "done", assessment: body } }));
      setStamps((current) => ({ ...current, [sku]: stampFor(sku, used, body) }));
      return body.roomId ?? payload.roomId;
    } catch {
      if (signatureRef.current !== used) return payload.roomId;
      setCards((current) => ({
        ...current,
        [sku]: { phase: "error", error: "The fit check could not reach the server." },
      }));
      return payload.roomId;
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
    const used = signatureRef.current;
    const payload = { roomId, ...measurementBody() };
    setPayConsent(false);
    setCards((current) => {
      const next = { ...current };
      for (const product of products) next[product.sku] = { phase: "loading" };
      return next;
    });
    try {
      const response = await fetch("/api/assessments/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        assessments?: AssessmentResponse[];
        roomId?: string | null;
        message?: string;
      };
      if (signatureRef.current !== used) {
        setCards((current) => {
          const next = { ...current };
          for (const product of products) {
            if (next[product.sku]?.phase === "loading") next[product.sku] = { phase: "idle" };
          }
          return next;
        });
        return;
      }
      if (!response.ok || !body.assessments) {
        setRoomNote(body.message ?? "The fit check failed.");
        setCards((current) => {
          const next = { ...current };
          for (const product of products) {
            if (next[product.sku]?.phase === "loading") {
              next[product.sku] = { phase: "error", error: body.message ?? "The fit check failed." };
            }
          }
          return next;
        });
        return;
      }
      if (!versionsAreConsistent(body.assessments.map((item) => item.measurementVersion))) {
        setRoomNote("The catalog check did not share one room version. Check again.");
        return;
      }
      if (body.roomId) setRoomId(body.roomId);
      const ids: string[] = [];
      const nextCards: Record<string, CardState> = {};
      const nextStamps: Record<string, AssessmentStamp | null> = {};
      for (const item of body.assessments) {
        const sku = item.product?.sku;
        if (!sku) continue;
        nextCards[sku] = { phase: "done", assessment: item };
        nextStamps[sku] = stampFor(sku, used, item);
        if (item.assessmentId) ids.push(item.assessmentId);
      }
      setCards((current) => ({ ...current, ...nextCards }));
      setStamps((current) => ({ ...current, ...nextStamps }));
      if (ids.length > 0) await rankFromLatest(ids);
    } catch {
      if (signatureRef.current === used) setRoomNote("The fit check could not reach the server.");
    } finally {
      setBusy(null);
    }
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
      if (body.changed) setConstraintEpoch((epoch) => epoch + 1);
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
  const selectedCurrent = Boolean(selected && assessmentIsCurrent(stamps[selected.sku], signature));
  const spaceStatus = !imageUrl
    ? "Upload a room photo"
    : !placement
      ? "Draw your space"
      : width.mm === null || depth.mm === null
        ? "Measurements needed"
        : confirmed && selectedCurrent
          ? "Ready to check"
          : confirmed
            ? "Confirmed"
            : placement.source === "ai" && !areaConfirmed
              ? "AI suggested"
              : "Edited by you";
  const sceneDirty = Boolean(selectedCard?.assessment) && !selectedCurrent;
  const catalogPrice = selected?.priceMinor ?? 0;
  const canOpenPayPal =
    checkoutMayOpen({
      stamp: selected ? stamps[selected.sku] : null,
      signature,
      catalogSku: selected?.sku ?? "",
      catalogPriceMinor: catalogPrice,
      consent: payConsent,
    }) &&
    paypal.ready &&
    Boolean(paypal.clientId) &&
    selectedPayment?.ledgerStatus !== "AUTHORIZED" &&
    selectedPayment?.displayStatus !== "CAPTURED" &&
    selectedPayment?.ledgerStatus !== "VOIDED";

  const results = Object.fromEntries(
    products.map((product) => [
      product.sku,
      assessmentIsCurrent(stamps[product.sku], signature) ? cards[product.sku]?.assessment?.result : undefined,
    ]),
  );
  const catalog = selectCatalog(products, results, filter, selectedSku, showAll, category);
  const obstacles = (analysis?.visible_obstacles ?? [])
    .map((item) => boxFromModel(item.bbox_normalized, item.label, "ai"))
    .filter((item): item is PlacementBox => item !== null);
  const steps = purchaseStages({
    confirmed,
    hasCurrentAssessment: selectedCurrent,
    paymentSettled: selectedPayment?.displayStatus === "CAPTURED" || selectedPayment?.displayStatus === "VOIDED",
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
      <ol className="grid grid-cols-3 gap-2" aria-label="Purchase steps">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className={`rounded-xl border px-2 py-2 sm:px-3 ${
              step.state === "current" ? "border-teal bg-card" : "border-line bg-card/70"
            }`}
          >
            <p className="text-[11px] font-semibold tracking-[0.14em] text-teal uppercase">0{index + 1}</p>
            <p className="text-sm font-medium sm:text-base">{step.label}</p>
            <p className="text-xs text-ink/55">{step.state === "done" ? "Done" : step.state === "current" ? "Now" : "Waiting"}</p>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
        <section className="rounded-3xl border border-line bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-teal uppercase">01 · Understand your space</p>
              <h2 className="font-display mt-1 text-3xl">Your room</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-ink/70">
                The photo can suggest a placement area. You enter the feet and inches. Nothing in the picture becomes a measurement.
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
                    event.currentTarget.value = "";
                    if (file) void analyzeFile(file, "photo");
                  }}
                />
              </label>
              <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => void useSample()}>
                Sample room
              </button>
            </div>
          </div>
          {visionError ? (
            <p className="mt-3 text-sm text-uncertain" data-testid="vision-error">
              {visionError}
            </p>
          ) : null}
          <div className="mt-4">
            <PlacementEditor
              imageUrl={imageUrl}
              box={placement}
              aiBox={aiPlacement}
              obstacles={obstacles}
              tool={tool}
              status={spaceStatus}
              regionLabel={placement?.source === "ai" ? "AI suggested" : "Edited by you"}
              suggesting={visionPhase === "loading"}
              onToolChange={setTool}
              onSuggest={() => void suggestAgain()}
              onClear={() => {
                manualEdit.current = true;
                setPlacement(null);
                setAreaConfirmed(false);
                setPayConsent(false);
                setTool("draw");
              }}
              onReset={() => {
                if (!aiPlacement) return;
                manualEdit.current = false;
                setPlacement(aiPlacement);
                setAreaConfirmed(false);
                setPayConsent(false);
                setTool("move");
              }}
              onConfirmArea={() => {
                if (!placement) return;
                manualEdit.current = true;
                setPlacement({ ...placement, source: "buyer" });
                setAreaConfirmed(true);
              }}
              onBoxChange={(box) => {
                manualEdit.current = true;
                setAreaConfirmed(false);
                setPayConsent(false);
                setPlacement({ ...box, label: "Buyer placement area", source: "buyer" });
              }}
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
            <h2 className="font-display text-3xl">Your available space</h2>
            <p className="mt-1 text-sm leading-6 text-ink/70">
              Enter feet and inches for the open floor. Clearance is in inches and is added to the furniture before the fit check.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-11 rounded-full border border-line px-3 text-sm"
                onClick={() => {
                  setWidth(lengthFieldsFromMillimeters(SCENARIO_A_WIDTH_MM));
                  setProvenance("demo_preset");
                  setConfirmed(false);
                  setPayConsent(false);
                }}
              >
                {lengthLabel(SCENARIO_A_WIDTH_MM)} room
              </button>
              <button
                type="button"
                className="min-h-11 rounded-full border border-line px-3 text-sm"
                onClick={() => {
                  setWidth(lengthFieldsFromMillimeters(SCENARIO_B_WIDTH_MM));
                  setProvenance("demo_preset");
                  setConfirmed(false);
                  setPayConsent(false);
                }}
              >
                {lengthLabel(SCENARIO_B_WIDTH_MM)} room
              </button>
            </div>
            <p className="mt-3 text-sm text-ink/70" data-testid="measurement-provenance">
              {provenanceLabel(provenance)}
            </p>
            <div className="mt-3 grid gap-3">
              <LengthControl
                id="room-width"
                label="Available width"
                feet={width.feet}
                inches={width.inches}
                onFeet={(feet) => {
                  setWidth((current) => editLength(current, { feet }));
                  setProvenance((current) => editMeasurement(current));
                  setConfirmed(false);
                  setPayConsent(false);
                }}
                onInches={(inches) => {
                  setWidth((current) => editLength(current, { inches }));
                  setProvenance((current) => editMeasurement(current));
                  setConfirmed(false);
                  setPayConsent(false);
                }}
              />
              <LengthControl
                id="room-depth"
                label="Available depth"
                feet={depth.feet}
                inches={depth.inches}
                onFeet={(feet) => {
                  setDepth((current) => editLength(current, { feet }));
                  setProvenance((current) => editMeasurement(current));
                  setConfirmed(false);
                  setPayConsent(false);
                }}
                onInches={(inches) => {
                  setDepth((current) => editLength(current, { inches }));
                  setProvenance((current) => editMeasurement(current));
                  setConfirmed(false);
                  setPayConsent(false);
                }}
              />
              <Field
                id="side-clearance"
                label="Side clearance"
                suffix="in"
                value={sideClearance.inches}
                onChange={(inches) => {
                  setSideClearance((current) => editClearance(current, inches));
                  setPayConsent(false);
                }}
              />
              <Field
                id="depth-clearance"
                label="Depth clearance"
                suffix="in"
                value={depthClearance.inches}
                onChange={(inches) => {
                  setDepthClearance((current) => editClearance(current, inches));
                  setPayConsent(false);
                }}
              />
              <Field
                id="room-budget"
                label="Maximum budget"
                suffix="USD"
                value={budget}
                onChange={(value) => {
                  setBudget(value);
                  setPayConsent(false);
                }}
              />
            </div>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={confirmed}
                onChange={(event) => {
                  const next = event.target.checked;
                  setConfirmed(next);
                  setPayConsent(false);
                  if (next) setProvenance(confirmMeasurements(width.mm, depth.mm));
                }}
              />
              <span>
                {confirmationStatement(width.mm, depth.mm)} I confirm these measurements for this photograph and placement. The photograph is not the source of the feet and inches.
              </span>
            </label>
            {confirmed ? <p className="mt-3 text-sm font-medium text-fit">Buyer-confirmed</p> : <p className="mt-3 text-sm text-uncertain">Not confirmed</p>}
            {sceneStale ? <p className="mt-3 text-sm leading-6 text-uncertain">{STALE_ASSESSMENT_NOTICE}</p> : null}
            {roomNote ? <p className="mt-3 text-sm leading-6">{roomNote}</p> : null}
            <button
              type="button"
              className="mt-4 min-h-11 w-full rounded-full bg-teal px-4 text-sm font-medium text-white disabled:opacity-60"
              disabled={busy !== null}
              onClick={() => void verifyAndExplain()}
            >
              {busy === "verify" ? "Checking the catalog…" : "Find what fits"}
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
              Describe a desk or compact dining table
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
                    ? `${inchesLabel(preferences.horizontal_clearance_mm)} side`
                    : "side not stated"}
                  {typeof preferences.depth_clearance_mm === "number"
                    ? `, ${inchesLabel(preferences.depth_clearance_mm)} depth`
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
            <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-teal uppercase">02 · Compare verified products</p>
            <h2 className="font-display mt-1 text-3xl">Demo merchant catalog</h2>
            <p className="mt-1 text-sm text-ink/65">
              {catalog.hidden > 0
                ? `Showing the closest matches. ${catalog.hidden} more ${catalog.hidden === 1 ? "is" : "are"} hidden.`
                : "Desks and compact dining tables. Prices come from the server catalog."}
            </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "desk", "dining_table"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`min-h-11 rounded-full border px-3 text-sm ${category === item ? "border-ink bg-ink text-paper" : "border-line bg-card"}`}
                onClick={() => setCategory(item)}
              >
                {item === "all" ? "All" : item === "desk" ? "Desks" : "Dining tables"}
              </button>
            ))}
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
                category={product.category}
                result={assessmentIsCurrent(stamps[product.sku], signature) ? card?.assessment?.result : undefined}
                stale={Boolean(card?.assessment) && !assessmentIsCurrent(stamps[product.sku], signature)}
                explanation={
                  card?.phase === "error"
                    ? (card.error ?? "The fit check failed.")
                    : card?.assessment && !assessmentIsCurrent(stamps[product.sku], signature)
                      ? "This check is out of date. Verify the catalog again."
                      : card?.assessment
                        ? (notes[product.sku] ?? verdict(card.assessment.result).summary)
                        : "Not checked yet."
                }
                selected={selectedSku === product.sku}
                loading={card?.phase === "loading"}
                onSelect={() => {
                  setSelectedSku(product.sku);
                  void checkFit(product.sku);
                  focusReview(product.sku);
                }}
                onDetails={() => focusReview(product.sku)}
              />
            );
          })}
        </div>
        {catalog.shown.length === 0 ? <p className="mt-4 text-sm text-ink/70">Nothing in this filter has a current result yet.</p> : null}
        {catalog.hidden > 0 ? (
          <button type="button" className="mt-4 min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => setShowAll(true)}>
            View all products
          </button>
        ) : showAll && filter === "all" && category === "all" ? (
          <button type="button" className="mt-4 min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => setShowAll(false)}>
            Show fewer products
          </button>
        ) : null}
      </section>

      <section id="fit-review" className="scroll-mt-6 rounded-3xl border border-line bg-card p-4 sm:p-5">
        {!selected || !selectedCard?.assessment ? (
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-teal uppercase">03 · Review FitPass and purchase</p>
            <h2 className="font-display mt-1 text-3xl">Review</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/75">
              Select a product. The FitPass and PayPal checkout stay together, using the price and result from the server.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-teal uppercase">03 · Review FitPass and purchase</p>
              <p className="mt-1 text-sm text-ink/60">{selected.title}</p>
              <div className="mt-4">
                <FitPass
                  assessment={selectedCard.assessment}
                  current={selectedCurrent}
                  widthMm={width.mm}
                  depthMm={depth.mm}
                  paymentStatus={selectedPayment?.displayStatus ?? null}
                />
              </div>
            </div>
            <div>
              <h2 className="font-display text-3xl">PayPal Sandbox checkout</h2>
              <p className="mt-2 text-sm text-ink/70">Catalog price {formatUsd(catalogPrice)}</p>
              {sceneDirty ? <p className="mt-3 text-sm leading-6 text-uncertain">{STALE_ASSESSMENT_NOTICE}</p> : null}
              {selectedCurrent && selectedCard.assessment.result === "FIT" && selectedCard.assessment.assessmentId ? (
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
                  <p className="font-semibold">Not eligible</p>
                  <p className="mt-1">{closedReason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href="#measurements" className="inline-flex min-h-11 items-center rounded-full border border-current px-4">
                      Correct measurements
                    </a>
                    <button type="button" className="min-h-11 rounded-full border border-current px-4" onClick={() => setShowAll(true)}>
                      Choose another product
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


function LengthControl({
  id,
  label,
  feet,
  inches,
  onFeet,
  onInches,
}: {
  id: string;
  label: string;
  feet: string;
  inches: string;
  onFeet: (value: string) => void;
  onInches: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-base">{label}</legend>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <label htmlFor={`${id}-ft`} className="block">
          <span className="mb-1 block text-sm text-ink/55">ft</span>
          <input
            id={`${id}-ft`}
            inputMode="decimal"
            value={feet}
            aria-label={`${label} feet`}
            onChange={(event) => onFeet(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-paper px-3 py-2"
          />
        </label>
        <label htmlFor={`${id}-in`} className="block">
          <span className="mb-1 block text-sm text-ink/55">in</span>
          <input
            id={`${id}-in`}
            inputMode="decimal"
            value={inches}
            aria-label={`${label} inches`}
            onChange={(event) => onInches(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-paper px-3 py-2"
          />
        </label>
      </div>
    </fieldset>
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
