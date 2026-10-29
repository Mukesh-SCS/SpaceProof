import { readAssessmentRequest } from "@/lib/assessments";
import { recordSceneAssessments } from "@/lib/record-assessment";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }

  const parsed = readAssessmentRequest(payload);
  if (!parsed.ok) {
    return Response.json({ message: parsed.message }, { status: 400 });
  }

  const saved = await recordSceneAssessments(parsed);
  if ("missingRoom" in saved) {
    return Response.json({ message: "That room measurement does not exist." }, { status: 404 });
  }
  if ("conflict" in saved) {
    return Response.json({ message: "The room changed while it was being saved. Check the fit again." }, { status: 409 });
  }

  return Response.json(saved.assessment, {
    status: saved.assessment.product ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
