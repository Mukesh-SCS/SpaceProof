/**
 * Read stored Sandbox resource IDs. Does not create, capture, or void anything.
 * Prints status fields only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPayPalGateway } from "../src/lib/paypal/gateway";

function loadEnv(path: string) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function safe(error: unknown) {
  if (error && typeof error === "object" && "httpStatus" in error) {
    const typed = error as { httpStatus?: number; issue?: string; message?: string };
    return { httpStatus: typed.httpStatus, issue: typed.issue, message: typed.message };
  }
  return { message: error instanceof Error ? error.name : "error" };
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env"));
  const gateway = createPayPalGateway();
  const reads = [
    ["order", "8NN90589CS658724M", () => gateway.getOrder("8NN90589CS658724M")],
    ["authorization", "93V392390C594062Y", () => gateway.getAuthorization("93V392390C594062Y")],
    ["capture", "66M90673NA362091J", () => gateway.getCapture("66M90673NA362091J")],
    ["order", "4JY697996K476130H", () => gateway.getOrder("4JY697996K476130H")],
    ["order", "4T750388D0073720Y", () => gateway.getOrder("4T750388D0073720Y")],
  ] as const;
  for (const [kind, id, read] of reads) {
    try {
      const snapshot = await read();
      console.log(
        JSON.stringify({
          kind,
          id,
          status: snapshot.status,
          authorizationId: snapshot.authorizationId,
          authorizationStatus: snapshot.authorizationStatus,
          captureId: snapshot.captureId,
          captureStatus: snapshot.captureStatus,
          amountValue: snapshot.amountValue,
          currency: snapshot.currency,
        }),
      );
    } catch (error) {
      console.log(JSON.stringify({ kind, id, error: safe(error) }));
    }
  }
}

main();
