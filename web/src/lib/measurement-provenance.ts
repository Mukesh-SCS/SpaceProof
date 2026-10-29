export type MeasurementProvenance =
  | "buyer_entered"
  | "buyer_confirmed"
  | "calibrated"
  | "demo_preset"
  | "not_measured";

export function provenanceLabel(provenance: MeasurementProvenance): string {
  if (provenance === "buyer_entered") return "Buyer entered";
  if (provenance === "buyer_confirmed") return "Buyer confirmed";
  if (provenance === "calibrated") return "Calibrated from a verified scale";
  if (provenance === "demo_preset") return "Demo preset, not measured from photo";
  return "Not measured";
}

export interface MeasurementDraft {
  widthMm: number | null;
  depthMm: number | null;
  sideClearanceMm: number | null;
  depthClearanceMm: number | null;
  budget: string;
  provenance: MeasurementProvenance;
  confirmed: boolean;
}

/** Sample diagrams may show the known demo corner. A real upload starts unmeasured. */
export function measurementsForImage(kind: "sample" | "photo"): MeasurementDraft {
  if (kind === "sample") {
    return {
      widthMm: 1500,
      depthMm: 1200,
      sideClearanceMm: 200,
      depthClearanceMm: 200,
      budget: "180",
      provenance: "demo_preset",
      confirmed: false,
    };
  }
  return {
    widthMm: null,
    depthMm: null,
    sideClearanceMm: 200,
    depthClearanceMm: 200,
    budget: "180",
    provenance: "not_measured",
    confirmed: false,
  };
}

export function editMeasurement(provenance: MeasurementProvenance): MeasurementProvenance {
  if (provenance === "calibrated") return "calibrated";
  return "buyer_entered";
}

export function confirmMeasurements(widthMm: number | null, depthMm: number | null): MeasurementProvenance {
  if (widthMm === null || depthMm === null) return "not_measured";
  return "buyer_confirmed";
}
