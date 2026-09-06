import { and, asc, desc, eq, gt, inArray, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  aiApprovalTable,
  aiAttachmentTable,
  aiConversationTable,
  aiMessageTable,
  aiMessageAttachmentTable,
  aiRunEventTable,
  aiRunTable,
} from "@/db/schema";
import { validateAiAttachmentBatch, type ValidatedAiAttachment } from "@/lib/ai/attachments";
import { createHttpError } from "@/lib/api-error";
import type { AiAttachment, AiRoute } from "@/types/ai";

export type AiScope = {
  userId: string;
  owner: string;
  repo: string;
  branch: string;
};

export const conversationWhere = (scope: AiScope, conversationId: string) => and(
  eq(aiConversationTable.id, conversationId),
  eq(aiConversationTable.userId, scope.userId),
  eq(aiConversationTable.owner, scope.owner),
  eq(aiConversationTable.repo, scope.repo),
  eq(aiConversationTable.branch, scope.branch),
);

export async function requireAiConversation(scope: AiScope, conversationId: string) {
  const [conversation] = await db.select().from(aiConversationTable)
    .where(conversationWhere(scope, conversationId)).limit(1);
  if (!conversation) throw createHttpError("Conversation not found.", 404);
  return conversation;
}

export async function listAiConversations(scope: AiScope) {
  return db.select().from(aiConversationTable).where(and(
    eq(aiConversationTable.userId, scope.userId),
    eq(aiConversationTable.owner, scope.owner),
    eq(aiConversationTable.repo, scope.repo),
    eq(aiConversationTable.branch, scope.branch),
  )).orderBy(desc(aiConversationTable.updatedAt)).limit(100);
}

export async function createAiConversation(scope: AiScope) {
  const [conversation] = await db.insert(aiConversationTable).values({
    id: crypto.randomUUID(),
    ...scope,
  }).returning();
  return conversation;
}

export async function getAiConversationDetail(scope: AiScope, conversationId: string) {
  const conversation = await requireAiConversation(scope, conversationId);
  const messageRows = await db.select().from(aiMessageTable)
    .where(eq(aiMessageTable.conversationId, conversationId))
    .orderBy(asc(aiMessageTable.createdAt));
  const attachmentRows = await db.select({
    messageId: aiMessageAttachmentTable.messageId,
    id: aiAttachmentTable.id,
    name: aiAttachmentTable.name,
    mediaType: aiAttachmentTable.mediaType,
    kind: aiAttachmentTable.kind,
    sizeBytes: aiAttachmentTable.sizeBytes,
  }).from(aiMessageAttachmentTable)
    .innerJoin(aiAttachmentTable, eq(aiMessageAttachmentTable.attachmentId, aiAttachmentTable.id))
    .where(eq(aiAttachmentTable.conversationId, conversationId))
    .orderBy(asc(aiMessageAttachmentTable.position));
  const attachmentsByMessage = new Map<string, AiAttachment[]>();
  for (const row of attachmentRows) {
    const attachments = attachmentsByMessage.get(row.messageId) || [];
    attachments.push({
      id: row.id,
      name: row.name,
      mediaType: row.mediaType,
      kind: row.kind as AiAttachment["kind"],
      sizeBytes: row.sizeBytes,
    });
    attachmentsByMessage.set(row.messageId, attachments);
  }
  const messages = messageRows.map((message) => ({
    ...message,
    attachments: attachmentsByMessage.get(message.id) || [],
  }));
  const runs = await db.select().from(aiRunTable)
    .where(eq(aiRunTable.conversationId, conversationId))
    .orderBy(asc(aiRunTable.createdAt));
  const approvals = runs.length === 0
    ? []
    : (await Promise.all(runs.map((run) => db.select().from(aiApprovalTable)
      .where(eq(aiApprovalTable.runId, run.id)).orderBy(asc(aiApprovalTable.createdAt)))))
      .flat();
  const events = runs.length === 0
    ? []
    : (await Promise.all(runs.map((run) => db.select().from(aiRunEventTable)
      .where(eq(aiRunEventTable.runId, run.id)).orderBy(asc(aiRunEventTable.id)).limit(1000))))
      .flat();
  return { conversation, messages, runs, approvals, events };
}

export async function createAiRun(
  scope: AiScope,
  conversationId: string,
  content: string,
  route: AiRoute,
  attachmentInput: {
    uploads: ValidatedAiAttachment[];
    attachmentIds: string[];
  } = { uploads: [], attachmentIds: [] },
) {
  const conversation = await requireAiConversation(scope, conversationId);
  const attachmentIds = [...new Set(attachmentInput.attachmentIds)];
  const reusedAttachments = attachmentIds.length === 0 ? [] : await db.select({
    id: aiAttachmentTable.id,
    name: aiAttachmentTable.name,
    mediaType: aiAttachmentTable.mediaType,
    kind: aiAttachmentTable.kind,
    sizeBytes: aiAttachmentTable.sizeBytes,
  }).from(aiAttachmentTable).where(and(
    eq(aiAttachmentTable.conversationId, conversationId),
    inArray(aiAttachmentTable.id, attachmentIds),
  ));
  if (reusedAttachments.length !== attachmentIds.length) {
    throw createHttpError("One or more attachments are unavailable.", 400);
  }
  const [{ totalBytes }] = await db.select({ totalBytes: sum(aiAttachmentTable.sizeBytes) })
    .from(aiAttachmentTable)
    .where(eq(aiAttachmentTable.conversationId, conversationId));
  validateAiAttachmentBatch(
    [...reusedAttachments, ...attachmentInput.uploads],
    Number(totalBytes || 0),
    attachmentInput.uploads.reduce((total, attachment) => total + attachment.sizeBytes, 0),
  );

  const messageId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const now = new Date();
  const attachmentNames = [...reusedAttachments, ...attachmentInput.uploads].map((attachment) => attachment.name);
  const title = content.trim().replace(/\s+/g, " ").slice(0, 72)
    || attachmentNames.join(", ").slice(0, 72)
    || "New conversation";

  await db.transaction(async (tx) => {
    await tx.insert(aiMessageTable).values({
      id: messageId,
      conversationId,
      role: "user",
      content,
      metadata: {},
      createdAt: now,
    });
    const uploadedRows = attachmentInput.uploads.map((attachment) => ({
      id: crypto.randomUUID(),
      conversationId,
      ...attachment,
      createdAt: now,
    }));
    if (uploadedRows.length > 0) await tx.insert(aiAttachmentTable).values(uploadedRows);
    const linkedIds = [...attachmentIds, ...uploadedRows.map((attachment) => attachment.id)];
    if (linkedIds.length > 0) {
      await tx.insert(aiMessageAttachmentTable).values(linkedIds.map((attachmentId, position) => ({
        messageId,
        attachmentId,
        position,
      })));
    }
    await tx.insert(aiRunTable).values({
      id: runId,
      conversationId,
      userMessageId: messageId,
      model: route.model,
      effort: route.effort,
      category: route.category,
      rationale: route.rationale,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await tx.update(aiConversationTable).set({
      title: conversation.title === "New conversation" ? title : conversation.title,
      updatedAt: now,
    }).where(eq(aiConversationTable.id, conversationId));
  });

  return { runId, messageId };
}

export async function getAiMessageAttachments(messageId: string) {
  return db.select({
    id: aiAttachmentTable.id,
    name: aiAttachmentTable.name,
    mediaType: aiAttachmentTable.mediaType,
    kind: aiAttachmentTable.kind,
    sizeBytes: aiAttachmentTable.sizeBytes,
    content: aiAttachmentTable.content,
  }).from(aiMessageAttachmentTable)
    .innerJoin(aiAttachmentTable, eq(aiMessageAttachmentTable.attachmentId, aiAttachmentTable.id))
    .where(eq(aiMessageAttachmentTable.messageId, messageId))
    .orderBy(asc(aiMessageAttachmentTable.position));
}

export async function requireAiAttachment(
  scope: AiScope,
  conversationId: string,
  attachmentId: string,
) {
  await requireAiConversation(scope, conversationId);
  const [attachment] = await db.select().from(aiAttachmentTable).where(and(
    eq(aiAttachmentTable.id, attachmentId),
    eq(aiAttachmentTable.conversationId, conversationId),
  )).limit(1);
  if (!attachment) throw createHttpError("Attachment not found.", 404);
  return attachment;
}

export async function appendAiEvent(runId: string, type: string, data: Record<string, unknown> = {}) {
  const [event] = await db.insert(aiRunEventTable).values({ runId, type, data }).returning();
  return event;
}

export async function listAiEvents(runId: string, after = 0) {
  return db.select().from(aiRunEventTable).where(and(
    eq(aiRunEventTable.runId, runId),
    gt(aiRunEventTable.id, after),
  )).orderBy(asc(aiRunEventTable.id)).limit(500);
}

export async function requireScopedRun(scope: AiScope, conversationId: string, runId: string) {
  await requireAiConversation(scope, conversationId);
  const [run] = await db.select().from(aiRunTable).where(and(
    eq(aiRunTable.id, runId),
    eq(aiRunTable.conversationId, conversationId),
  )).limit(1);
  if (!run) throw createHttpError("AI run not found.", 404);
  return run;
}

export async function completeAiRun(runId: string, content: string, metadata: Record<string, unknown>) {
  const [run] = await db.select().from(aiRunTable).where(eq(aiRunTable.id, runId)).limit(1);
  if (!run) throw new Error("AI run not found.");
  const messageId = crypto.randomUUID();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(aiMessageTable).values({
      id: messageId,
      conversationId: run.conversationId,
      role: "assistant",
      content,
      metadata,
      createdAt: now,
    });
    await tx.update(aiRunTable).set({
      assistantMessageId: messageId,
      status: "completed",
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiRunTable.id, runId));
    await tx.update(aiConversationTable).set({ updatedAt: now })
      .where(eq(aiConversationTable.id, run.conversationId));
  });
  await appendAiEvent(runId, "run.completed", { messageId });
}

export async function failAiRun(runId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "AI run failed.";
  await db.update(aiRunTable).set({
    status: "failed",
    failure: { message },
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(aiRunTable.id, runId));
  await appendAiEvent(runId, "run.failed", { message });
}
