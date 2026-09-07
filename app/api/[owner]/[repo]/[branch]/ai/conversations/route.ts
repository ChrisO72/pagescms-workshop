import { getAiApiContext } from "@/lib/ai/api";
import { createAiConversation, getAiConversationListState } from "@/lib/ai/store";
import { prepareAiChatActivation } from "@/lib/ai/runtime";
import { toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    return Response.json({ data: await getAiConversationListState(scope) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    const body = request.headers.get("content-length") === "0"
      ? {}
      : await request.json().catch(() => ({}));
    await prepareAiChatActivation(scope, null, body?.discardUnpublished === true);
    return Response.json({ data: await createAiConversation(scope) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
