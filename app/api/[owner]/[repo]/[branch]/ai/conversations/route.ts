import { getAiApiContext } from "@/lib/ai/api";
import { createAiConversation, listAiConversations } from "@/lib/ai/store";
import { toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    return Response.json({ data: await listAiConversations(scope) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    return Response.json({ data: await createAiConversation(scope) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
