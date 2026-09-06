import { getAiApiContext } from "@/lib/ai/api";
import { cancelAiRun } from "@/lib/ai/runtime";
import { requireScopedRun } from "@/lib/ai/store";
import { createHttpError, toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string; conversationId: string; runId: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    const run = await requireScopedRun(scope, params.conversationId, params.runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      throw createHttpError("This run is already finished.", 409);
    }
    await cancelAiRun(params.runId);
    return Response.json({ data: { id: params.runId, status: "cancelled" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
