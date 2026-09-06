import { getAiApiContext } from "@/lib/ai/api";
import { requireAiAttachment } from "@/lib/ai/store";
import { toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      owner: string;
      repo: string;
      branch: string;
      conversationId: string;
      attachmentId: string;
    }>;
  },
) {
  try {
    const params = await context.params;
    const { scope } = await getAiApiContext(params);
    const attachment = await requireAiAttachment(scope, params.conversationId, params.attachmentId);
    const disposition = attachment.kind === "image" ? "inline" : "attachment";
    const encodedName = encodeURIComponent(attachment.name);
    return new Response(new Uint8Array(attachment.content), {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(attachment.sizeBytes),
        "Content-Type": attachment.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
