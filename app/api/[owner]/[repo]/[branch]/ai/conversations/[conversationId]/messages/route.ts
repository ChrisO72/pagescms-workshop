import { z } from "zod";
import { getAiApiContext } from "@/lib/ai/api";
import { routeAiMessage } from "@/lib/ai/router";
import { createAiRun, requireAiConversation } from "@/lib/ai/store";
import { prepareAiChatActivation, startAiRun } from "@/lib/ai/runtime";
import { validateAiAttachment } from "@/lib/ai/attachments";
import { createHttpError, toErrorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  discardUnpublished: z.boolean().optional(),
});
const MAX_MULTIPART_BYTES = Math.floor(4.5 * 1024 * 1024);

export async function POST(
  request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string; conversationId: string }> },
) {
  try {
    const params = await context.params;
    const contentType = request.headers.get("content-type") || "";
    let content = "";
    let files: File[] = [];
    let attachmentIds: string[] = [];
    let discardUnpublished = false;
    if (contentType.includes("multipart/form-data")) {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > MAX_MULTIPART_BYTES) {
        throw createHttpError("Attachments can total at most 4 MiB per message.", 413);
      }
      const form = await request.formData();
      content = String(form.get("content") || "").trim();
      files = form.getAll("files").filter((value): value is File => value instanceof File);
      attachmentIds = form.getAll("attachmentIds")
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      discardUnpublished = form.get("discardUnpublished") === "true";
      if (content.length > 20_000) {
        throw createHttpError("Messages can contain at most 20,000 characters.", 400);
      }
      if (!content && files.length === 0 && attachmentIds.length === 0) {
        throw createHttpError("Add a message or at least one attachment.", 400);
      }
    } else {
      const parsed = bodySchema.safeParse(await request.json());
      if (!parsed.success) throw createHttpError("A message between 1 and 20,000 characters is required.", 400);
      content = parsed.data.content;
      discardUnpublished = parsed.data.discardUnpublished === true;
    }
    const uploads = await Promise.all(files.map(async (file) => (
      validateAiAttachment(file.name, new Uint8Array(await file.arrayBuffer()))
    )));
    const { scope } = await getAiApiContext(params);
    await requireAiConversation(scope, params.conversationId);
    await prepareAiChatActivation(scope, params.conversationId, discardUnpublished);
    const routingMessage = [
      content || "Please inspect the attached files.",
      uploads.length > 0 ? `Attached files: ${uploads.map((file) => file.name).join(", ")}` : "",
      attachmentIds.length > 0 ? `${attachmentIds.length} previously uploaded file(s) attached.` : "",
    ].filter(Boolean).join("\n\n");
    const route = await routeAiMessage(routingMessage);
    const run = await createAiRun(scope, params.conversationId, content, route, { uploads, attachmentIds });
    startAiRun(run.runId);
    return Response.json({ data: { ...run, route } }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
