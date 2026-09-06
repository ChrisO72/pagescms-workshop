import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  aiApprovalTable,
  aiConversationTable,
  aiMessageTable,
  aiRunEventTable,
  aiRunTable,
} from "@/db/schema";
import { createHttpError } from "@/lib/api-error";
import type { AiRoute } from "@/types/ai";

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
  const messages = await db.select().from(aiMessageTable)
    .where(eq(aiMessageTable.conversationId, conversationId))
    .orderBy(asc(aiMessageTable.createdAt));
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
) {
  const conversation = await requireAiConversation(scope, conversationId);
  const messageId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const now = new Date();
  const title = content.trim().replace(/\s+/g, " ").slice(0, 72) || "New conversation";

  await db.transaction(async (tx) => {
    await tx.insert(aiMessageTable).values({
      id: messageId,
      conversationId,
      role: "user",
      content,
      metadata: {},
      createdAt: now,
    });
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
