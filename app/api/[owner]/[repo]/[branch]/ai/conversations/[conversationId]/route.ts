import { getAiApiContext } from "@/lib/ai/api";
import { getAiConversationDetail } from "@/lib/ai/store";
import { toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string; conversationId: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    return Response.json({ data: await getAiConversationDetail(scope, params.conversationId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
