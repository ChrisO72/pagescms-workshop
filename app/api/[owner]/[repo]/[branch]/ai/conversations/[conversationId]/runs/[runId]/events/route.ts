import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiRunTable } from "@/db/schema";
import { getAiApiContext } from "@/lib/ai/api";
import { listAiEvents, requireScopedRun } from "@/lib/ai/store";
import { toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terminal = new Set(["completed", "failed", "cancelled"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string; conversationId: string; runId: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    await requireScopedRun(scope, params.conversationId, params.runId);
    const headerId = Number(request.headers.get("last-event-id") || "0");
    const queryId = Number(new URL(request.url).searchParams.get("after") || "0");
    let cursor = Number.isFinite(headerId) && headerId > 0 ? headerId : queryId;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const startedAt = Date.now();
        try {
          while (!request.signal.aborted && Date.now() - startedAt < 25_000) {
            const events = await listAiEvents(params.runId, cursor);
            for (const event of events) {
              cursor = event.id;
              controller.enqueue(encoder.encode(
                `id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`,
              ));
            }
            const [run] = await db.select({ status: aiRunTable.status })
              .from(aiRunTable).where(eq(aiRunTable.id, params.runId)).limit(1);
            if (run && terminal.has(run.status) && events.length === 0) break;
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
