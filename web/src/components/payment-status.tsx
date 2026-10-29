import type { PaymentView } from "@/lib/api-types";
import { paymentPresentation } from "@/components/experience";

const tones: Record<string, string> = {
  AUTHORIZED: "border-authorized/30 bg-authorized/10 text-authorized",
  CAPTURED: "border-captured/30 bg-captured/10 text-captured",
  VOIDED: "border-voided/30 bg-voided/10 text-voided",
  FAILED: "border-nofit/30 bg-nofit/10 text-nofit",
  CANCELED: "border-uncertain/30 bg-uncertain/15 text-uncertain",
  CREATED: "border-line bg-paper text-ink",
};

export function PaymentStatus({
  payment,
  busy,
  sku,
  historical = false,
  onCapture,
  onVoid,
  onSaveRoom,
}: {
  payment: PaymentView;
  busy: string | null;
  sku: string;
  historical?: boolean;
  onCapture: () => void;
  onVoid: () => void;
  onSaveRoom: () => void;
}) {
  const view = paymentPresentation(payment);
  const tone = tones[view.status] ?? tones.CREATED;
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-xs font-medium tracking-wide uppercase">{historical ? "Earlier transaction" : "This checkout"}</p>
      <p className="mt-1 text-lg font-semibold">{view.status}</p>
      <p className="mt-2 text-sm leading-6">{payment.message}</p>
      <p className="mt-3 text-sm">Amount {view.amount}</p>
      <p className="text-sm">PayPal order {payment.orderId}</p>
      {payment.authorizationId ? <p className="text-sm">Authorization {payment.authorizationId}</p> : null}
      {view.receipt && payment.captureId ? <p className="text-sm">Capture {payment.captureId}</p> : null}
      {view.authorized ? (
        <p className="mt-3 text-sm leading-6">
          PayPal placed a hold. The payment is not captured yet. Capture rechecks the room. If the desk no longer fits,
          SpaceProof voids the authorization instead.
        </p>
      ) : null}
      {view.voided ? (
        <p className="mt-3 text-sm leading-6">The final check failed, so this authorization was voided. No completed payment was recorded.</p>
      ) : null}
      {view.authorized ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-full bg-ink px-4 text-sm text-paper disabled:opacity-60"
            disabled={busy !== null}
            onClick={onCapture}
          >
            {busy === `${sku}:capture` ? "Checking, then capturing…" : "Capture payment"}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full border border-current px-4 text-sm disabled:opacity-60"
            disabled={busy !== null}
            onClick={onSaveRoom}
          >
            Save corrected room
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full border border-current px-4 text-sm disabled:opacity-60"
            disabled={busy !== null}
            onClick={onVoid}
          >
            {busy === `${sku}:void` ? "Voiding…" : "Void authorization"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
