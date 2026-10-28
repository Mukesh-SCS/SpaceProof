"use client";

import { useEffect, useRef, useState } from "react";
import type { PaymentView } from "@/lib/api-types";

interface PayPalButtons {
  render: (element: HTMLElement) => Promise<void>;
  close: () => void;
}

interface PayPalNamespace {
  Buttons: (config: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel: (data: { orderID?: string }) => Promise<void>;
    onError: (error: unknown) => void;
  }) => PayPalButtons;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

type Phase = "loading-sdk" | "ready" | "authorizing" | "authorized" | "canceled" | "failed";

export function PayPalCheckout({
  assessmentId,
  clientId,
  onAuthorized,
}: {
  assessmentId: string;
  clientId: string;
  onAuthorized: (payment: PaymentView) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onAuthorizedRef = useRef(onAuthorized);
  const [phase, setPhase] = useState<Phase>("loading-sdk");
  const [message, setMessage] = useState<string | null>(null);
  onAuthorizedRef.current = onAuthorized;

  useEffect(() => {
    let cancelled = false;
    let buttons: PayPalButtons | null = null;
    const container = containerRef.current;
    if (!container) return;

    const render = () => {
      if (cancelled || !container || !window.paypal) return;
      container.replaceChildren();
      buttons = window.paypal.Buttons({
        createOrder: async () => {
          const response = await fetch("/api/paypal/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assessmentId, consent: true }),
          });
          const body = (await response.json()) as { id?: string; message?: string };
          if (!response.ok || typeof body.id !== "string") {
            throw new Error(body.message ?? "PayPal order was not created.");
          }
          return body.id;
        },
        onApprove: async (data) => {
          setPhase("authorizing");
          setMessage("Authorizing the PayPal order on the server…");
          const response = await fetch(`/api/paypal/orders/${encodeURIComponent(data.orderID)}/authorize`, {
            method: "POST",
          });
          const body = (await response.json()) as Partial<PaymentView> & { message?: string };
          if (
            body.ledgerStatus === "AUTHORIZED" &&
            body.completed !== true &&
            typeof body.authorizationId === "string" &&
            typeof body.orderId === "string" &&
            typeof body.amountMinor === "number" &&
            typeof body.currency === "string" &&
            typeof body.displayStatus === "string" &&
            typeof body.providerStatus === "string" &&
            typeof body.message === "string"
          ) {
            onAuthorizedRef.current({
              completed: false,
              ledgerStatus: body.ledgerStatus,
              displayStatus: body.displayStatus,
              providerStatus: body.providerStatus,
              orderId: body.orderId,
              authorizationId: body.authorizationId,
              captureId: null,
              amountMinor: body.amountMinor,
              currency: body.currency,
              message: body.message,
            });
            setPhase("authorized");
            setMessage("PayPal authorized the payment. It is not captured yet.");
            return;
          }
          setPhase("failed");
          setMessage(body.message ?? "PayPal did not authorize the payment.");
        },
        onCancel: async (data) => {
          if (data.orderID) {
            await fetch(`/api/paypal/orders/${encodeURIComponent(data.orderID)}/cancel`, { method: "POST" });
          }
          setPhase("canceled");
          setMessage("Checkout was canceled. No completed payment was recorded.");
        },
        onError: () => {
          setPhase("failed");
          setMessage("PayPal reported an error. No completed payment was recorded.");
        },
      });
      void buttons.render(container).then(() => {
        if (!cancelled) setPhase("ready");
      });
    };

    const onLoad = () => render();
    let script = document.querySelector<HTMLScriptElement>("script[data-spaceproof-paypal='authorize']");
    if (window.paypal && script) {
      render();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=authorize&components=buttons`;
        script.async = true;
        script.dataset.spaceproofPaypal = "authorize";
        script.addEventListener("error", () => {
          if (!cancelled) {
            setPhase("failed");
            setMessage("The PayPal checkout script could not be loaded.");
          }
        });
        document.body.appendChild(script);
      }
      if (window.paypal) render();
      else script.addEventListener("load", onLoad);
    }

    return () => {
      cancelled = true;
      script?.removeEventListener("load", onLoad);
      buttons?.close();
      container.replaceChildren();
    };
  }, [assessmentId, clientId]);

  return (
    <div className="space-y-3">
      {phase === "loading-sdk" ? <p className="text-sm text-ink/70">Loading PayPal sandbox…</p> : null}
      {phase === "authorizing" ? <p className="text-sm text-ink/70">Authorizing with PayPal…</p> : null}
      {phase === "authorized" ? null : <div ref={containerRef} />}
      {phase === "authorized" ? <p className="text-sm text-authorized">{message}</p> : null}
      {phase === "canceled" ? <p className="text-sm text-uncertain">{message}</p> : null}
      {phase === "failed" ? <p className="text-sm text-nofit">{message}</p> : null}
    </div>
  );
}
