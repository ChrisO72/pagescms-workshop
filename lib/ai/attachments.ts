import { createHttpError } from "@/lib/api-error";
import {
  AI_ATTACHMENT_CONVERSATION_MAX_BYTES,
  AI_ATTACHMENT_MAX_BYTES,
  AI_ATTACHMENT_MAX_FILES,
} from "@/types/ai";

const textExtensions = new Set([
  "txt", "md", "csv", "json", "jsonl", "yaml", "yml", "xml", "html", "css",
  "scss", "js", "jsx", "ts", "tsx", "mjs", "cjs", "astro", "vue", "svelte",
  "toml", "ini", "env", "sql", "graphql", "gql", "sh", "svg",
]);

export type ValidatedAiAttachment = {
  name: string;
  mediaType: string;
  kind: "image" | "text";
  sizeBytes: number;
  content: Buffer;
};

function extensionOf(name: string) {
  const basename = name.split(/[\\/]/).at(-1) || "";
  if (basename === ".env") return "env";
  const dot = basename.lastIndexOf(".");
  return dot > -1 ? basename.slice(dot + 1).toLowerCase() : "";
}

function sniffImage(content: Uint8Array): string | null {
  if (
    content.length >= 8
    && content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47
    && content[4] === 0x0d && content[5] === 0x0a && content[6] === 0x1a && content[7] === 0x0a
  ) return "image/png";
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    content.length >= 12
    && String.fromCharCode(...content.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...content.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

export function safeAiAttachmentName(name: string) {
  const basename = name.split(/[\\/]/).at(-1)?.trim() || "attachment";
  return basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "-")
    .replace(/^\.+/, "")
    .slice(0, 160) || "attachment";
}

export function validateAiAttachment(
  name: string,
  bytes: Uint8Array,
): ValidatedAiAttachment {
  const safeName = safeAiAttachmentName(name);
  if (bytes.byteLength === 0) throw createHttpError(`${safeName} is empty.`, 400);
  if (bytes.byteLength > AI_ATTACHMENT_MAX_BYTES) {
    throw createHttpError(`Attachments can be at most 4 MiB per message.`, 413);
  }

  const content = Buffer.from(bytes);
  const imageType = sniffImage(content);
  if (imageType) {
    return { name: safeName, mediaType: imageType, kind: "image", sizeBytes: content.length, content };
  }

  if (!textExtensions.has(extensionOf(safeName))) {
    throw createHttpError(`${safeName} is not a supported image or text file.`, 415);
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw createHttpError(`${safeName} must contain valid UTF-8 text.`, 415);
  }
  if (content.includes(0)) throw createHttpError(`${safeName} appears to be a binary file.`, 415);

  const extension = extensionOf(safeName);
  const mediaType = extension === "json" || extension === "jsonl"
    ? "application/json"
    : extension === "svg" ? "image/svg+xml" : "text/plain";
  return { name: safeName, mediaType, kind: "text", sizeBytes: content.length, content };
}

export function validateAiAttachmentBatch(
  attachments: Array<{ sizeBytes: number }>,
  existingConversationBytes = 0,
  newBytes = attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0),
) {
  if (attachments.length > AI_ATTACHMENT_MAX_FILES) {
    throw createHttpError(`Attach up to ${AI_ATTACHMENT_MAX_FILES} files per message.`, 400);
  }
  const total = attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
  if (total > AI_ATTACHMENT_MAX_BYTES) {
    throw createHttpError("Attachments can total at most 4 MiB per message.", 413);
  }
  if (existingConversationBytes + newBytes > AI_ATTACHMENT_CONVERSATION_MAX_BYTES) {
    throw createHttpError("This conversation has reached its 40 MiB attachment limit.", 413);
  }
}
