"use client";

import { useState } from "react";
import type { AssessmentResponse, PaymentView } from "@/lib/api-types";
import { DEMO_ROOM } from "@/lib/demo-scenario";
import type { CatalogProduct } from "@/lib/geometry/fit";
import { formatUsd, parseUsdToMinor } from "@/lib/money";
import { FitResult } from "@/components/fit-result";
import { PayPalCheckout } from "@/components/paypal-checkout";

interface CardState {
  phase: "idle" | "loading" | "done" | "error";
  assessment?: AssessmentResponse;
  error?: string;
  payConsent: boolean;
}

const initialCard: CardState = { phase: "idle", payConsent: false };

const paymentTones: Record<string, string> = {
  AUTHORIZED: "border-authorized/30 bg-authorized/10 text-authorized",
  CAPTURED: "border-captured/30 bg-captured/10 text-captured",
  VOIDED: "border-voided/30 bg-voided/10 text-voided",
  FAILED: "border-nofit/30 bg-nofit/10 text-nofit",
  CANCELED: "border-uncertain/30 bg-uncertain/10 text-uncertain",
  PENDING: "border-line bg-paper text-ink",
  CREATED: "border-line bg-paper text-ink",
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
  const [confirmed, setConfirmed] = useState(true);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [payments, setPayments] = useState<Record<string, PaymentView | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function measurementBody() {
    return {
      availableWidthMm: centimetersToMillimeters(widthCm),
      availableDepthMm: centimetersToMillimeters(depthCm),
      requiredHorizontalClearanceMm: centimetersToMillimeters(sideClearanceCm),
      requiredDepthClearanceMm: centimetersToMillimeters(depthClearanceCm),
      budgetMinor: parseUsdToMinor(budget),
      currency: "USD",
      confirmed,
    };
  }

  async function checkFit(sku: string) {
    setCards((current) => ({ ...current, [sku]: { phase: "loading", payConsent: false } }));
    setPayments((current) => ({ ...current, [sku]: null }));
    const measured = measurementBody();
    try {
      const response = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, roomId, ...measured }),
      });
      const body = (await response.json()) as AssessmentResponse & { message?: string };
      if (!body.result) {
        setCards((current) => ({
          ...current,
          [sku]: { phase: "error", error: body.message ?? "The fit check failed.", payConsent: false },
        }));
        return;
      }
      if (body.roomId) setRoomId(body.roomId);
      setCards((current) => ({
        ...current,
        [sku]: { phase: "done", assessment: body, payConsent: false },
      }));
    } catch {
      setCards((current) => ({
        ...current,
        [sku]: { phase: "error", error: "The fit check could not reach the server.", payConsent: false },
      }));
    }
  }

  async function saveRoom(sku: string) {
    if (!roomId) return;
    setBusy(`${sku}:room`);
    setRoomNote(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(measurementBody()),
      });
      const body = (await response.json()) as {
        version?: number;
        previousVersion?: number;
        changed?: boolean;
        message?: string;
      };
      if (!response.ok) {
        setRoomNote(body.message ?? "The room could not be updated.");
        return;
      }
      setRoomNote(
        body.changed
          ? `Room measurements are now version ${body.version}. The previous fit assessment is no longer valid.`
          : `Room measurements are still version ${body.version}. Nothing relevant changed.`,
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

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <form className="h-fit rounded-2xl border border-line bg-card p-5" onSubmit={(event) => event.preventDefault()}>
        <h2 className="font-display text-2xl">Room</h2>
        <p className="mt-1 text-sm leading-6 text-ink/70">
          Enter whole centimeters. SpaceProof stores millimeters and checks them on the server.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="rounded-full border border-line px-3 py-1 text-xs" onClick={() => setWidthCm("100")}>
            100 cm room
          </button>
          <button type="button" className="rounded-full border border-line px-3 py-1 text-xs" onClick={() => setWidthCm("150")}>
            150 cm room
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <Field id="room-width" label="Room width" suffix="cm" value={widthCm} onChange={setWidthCm} />
          <Field id="room-depth" label="Room depth" suffix="cm" value={depthCm} onChange={setDepthCm} />
          <Field id="side-clearance" label="Side clearance" suffix="cm" value={sideClearanceCm} onChange={setSideClearanceCm} />
          <Field id="depth-clearance" label="Depth clearance" suffix="cm" value={depthClearanceCm} onChange={setDepthClearanceCm} />
          <Field id="room-budget" label="Maximum budget" suffix="USD" value={budget} onChange={setBudget} />
        </div>
        <p className="mt-3 text-xs leading-5 text-ink/60">
          {millimeterHint(widthCm)} wide · {millimeterHint(depthCm)} deep. Side clearance is added to the desk width.
          Depth clearance is added to the desk depth.
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I confirm these measurements. Unconfirmed measurements stay uncertain.</span>
        </label>
        {roomNote ? <p className="mt-3 text-sm leading-6 text-ink/80">{roomNote}</p> : null}
      </form>

      <section className="space-y-4">
        <h2 className="font-display text-2xl">Desks</h2>
        <div className="grid gap-4 xl:grid-cols-2">
          {products.map((product) => {
            const card = cards[product.sku] ?? initialCard;
            const assessment = card.assessment;
            const payment = payments[product.sku] ?? null;
            const catalogPrice = assessment?.comparison.priceMinor ?? product.priceMinor;
            const canOpenPayPal =
              assessment?.result === "FIT" &&
              typeof assessment.assessmentId === "string" &&
              card.payConsent &&
              paypal.ready &&
              paypal.clientId &&
              payment?.ledgerStatus !== "AUTHORIZED" &&
              payment?.displayStatus !== "CAPTURED" &&
              payment?.ledgerStatus !== "VOIDED";
            return (
              <article key={product.sku} className="rounded-2xl border border-line bg-card p-5">
                <h3 className="font-display text-xl">{product.title}</h3>
                <p className="mt-1 text-xs tracking-wide text-ink/50">{product.sku}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-ink/50">Width</dt>
                    <dd>{formatLength(product.widthMm)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/50">Depth</dt>
                    <dd>{formatLength(product.depthMm)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/50">Height</dt>
                    <dd>{formatLength(product.heightMm)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/50">Price</dt>
                    <dd>{formatUsd(product.priceMinor)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-ink/50">
                  {product.available ? "In the trusted catalog" : "Unavailable"}. Height is stored and is not part of the floor check.
                </p>
                <button
                  type="button"
                  onClick={() => void checkFit(product.sku)}
                  disabled={card.phase === "loading"}
                  className="mt-4 rounded-full bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {card.phase === "loading" ? "Checking fit…" : "Check fit"}
                </button>
                {card.phase === "error" ? <p className="mt-3 text-sm text-nofit">{card.error}</p> : null}
                {assessment ? <FitResult assessment={assessment} /> : null}
                {assessment?.result === "FIT" && assessment.assessmentId ? (
                  <div className="mt-4 border-t border-line pt-4">
                    {paypal.ready && paypal.clientId ? (
                      <>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={card.payConsent}
                            onChange={(event) =>
                              setCards((current) => ({
                                ...current,
                                [product.sku]: { ...card, payConsent: event.target.checked },
                              }))
                            }
                          />
                          <span>
                            I approve a PayPal Sandbox authorization for {formatUsd(catalogPrice)} on {product.title}.
                            The catalog price is the only amount that can be authorized. No real money moves.
                          </span>
                        </label>
                        {canOpenPayPal ? (
                          <div className="mt-3">
                            <PayPalCheckout
                              assessmentId={assessment.assessmentId}
                              clientId={paypal.clientId}
                              onAuthorized={(next) => setPayments((current) => ({ ...current, [product.sku]: next }))}
                            />
                          </div>
                        ) : payment ? null : (
                          <p className="mt-3 text-sm text-ink/60">Confirm the catalog price to open PayPal.</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm leading-6 text-ink/80">{paypal.message}</p>
                    )}
                  </div>
                ) : assessment ? (
                  <p className="mt-4 border-t border-line pt-4 text-sm text-ink/70">
                    Checkout stays closed. The server will not create a PayPal order for this result.
                  </p>
                ) : null}
                {payment ? (
                  <PaymentPanel
                    payment={payment}
                    busy={busy}
                    sku={product.sku}
                    onCapture={() => void settle(product.sku, payment.orderId, "capture")}
                    onVoid={() => void settle(product.sku, payment.orderId, "void")}
                    onSaveRoom={() => void saveRoom(product.sku)}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
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
    <div className={`mt-4 rounded-xl border p-3 text-sm ${tone}`}>
      <p className="font-semibold tracking-wide">{captured ? "CAPTURED" : payment.displayStatus}</p>
      <p className="mt-1 leading-6">{payment.message}</p>
      <p className="mt-2">Amount {formatUsd(payment.amountMinor)}</p>
      <p>PayPal order {payment.orderId}</p>
      {payment.authorizationId ? <p>Authorization {payment.authorizationId}</p> : null}
      {captured && payment.captureId ? <p>Capture {payment.captureId}</p> : null}
      {authorized ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full bg-ink px-3 py-1.5 text-xs text-paper disabled:opacity-60"
            disabled={busy !== null}
            onClick={onCapture}
          >
            {busy === `${sku}:capture` ? "Checking, then capturing…" : "Capture payment"}
          </button>
          <button
            type="button"
            className="rounded-full border border-current px-3 py-1.5 text-xs disabled:opacity-60"
            disabled={busy !== null}
            onClick={onSaveRoom}
          >
            {busy === `${sku}:room` ? "Saving room…" : "Save corrected room"}
          </button>
          <button
            type="button"
            className="rounded-full border border-current px-3 py-1.5 text-xs disabled:opacity-60"
            disabled={busy !== null}
            onClick={onVoid}
          >
            {busy === `${sku}:void` ? "Voiding…" : "Void authorization"}
          </button>
        </div>
      ) : null}
      {authorized ? (
        <p className="mt-3 text-xs leading-5">
          To show a blocked purchase, change the room width to 100 cm, save the corrected room, then capture. SpaceProof
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
    <label htmlFor={id} className="block text-sm">
      <span className="mb-1 flex justify-between">
        <span>{label}</span>
        <span className="text-ink/50">{suffix}</span>
      </span>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-line bg-paper px-3 py-2"
      />
    </label>
  );
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
  return millimeters % 10 === 0 ? `${millimeters / 10} cm (${millimeters} mm)` : `${millimeters} mm`;
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
