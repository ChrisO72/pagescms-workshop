import { z } from "zod";
import { getAiApiContext } from "@/lib/ai/api";
import { routeAiMessage } from "@/lib/ai/router";
import { createAiRun } from "@/lib/ai/store";
import { startAiRun } from "@/lib/ai/runtime";
import { createHttpError, toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ content: z.string().trim().min(1).max(20_000) });

export async function POST(
  request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string; conversationId: string }> },
) {
  try {
    const params = await context.params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) throw createHttpError("A message between 1 and 20,000 characters is required.", 400);
    const { scope } = await getAiApiContext(params);
    const route = await routeAiMessage(parsed.data.content);
    const run = await createAiRun(scope, params.conversationId, parsed.data.content, route);
    startAiRun(run.runId);
    return Response.json({ data: { ...run, route } }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
