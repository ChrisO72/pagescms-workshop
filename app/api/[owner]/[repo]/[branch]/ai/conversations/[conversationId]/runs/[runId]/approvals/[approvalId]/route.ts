import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiApprovalTable } from "@/db/schema";
import { getAiApiContext } from "@/lib/ai/api";
import { currentRepositorySha } from "@/lib/ai/repository";
import { appendAiEvent, requireScopedRun } from "@/lib/ai/store";
import { createHttpError, toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";

const bodySchema = z.object({ decision: z.enum(["approved", "rejected"]) });

export async function POST(
  request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string; conversationId: string; runId: string; approvalId: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    await requireScopedRun(scope, params.conversationId, params.runId);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) throw createHttpError("An approval decision is required.", 400);
    const [approval] = await db.select().from(aiApprovalTable).where(and(
      eq(aiApprovalTable.id, params.approvalId),
      eq(aiApprovalTable.runId, params.runId),
    )).limit(1);
    if (!approval) throw createHttpError("Approval not found.", 404);
    if (approval.status !== "pending") throw createHttpError("This approval was already decided.", 409);
    if (parsed.data.decision === "approved") {
      const currentSha = await currentRepositorySha(params.runId);
      if (currentSha !== approval.requestedSha) {
        throw createHttpError("The branch changed after this approval was requested.", 409);
      }
    }
    await db.update(aiApprovalTable).set({
      status: parsed.data.decision,
      decidedBy: scope.userId,
      decidedAt: new Date(),
    }).where(eq(aiApprovalTable.id, params.approvalId));
    await appendAiEvent(params.runId, `approval.${parsed.data.decision}`, { approvalId: params.approvalId });
    return Response.json({ data: { id: params.approvalId, status: parsed.data.decision } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
