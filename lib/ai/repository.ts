import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiConversationTable, aiRunTable, userTable } from "@/db/schema";
import { appendAiEvent } from "@/lib/ai/store";
import { triggerAiDeployment } from "@/lib/ai/deployments";
import { createHttpError } from "@/lib/api-error";
import { getToken } from "@/lib/token";
import { createOctokitInstance } from "@/lib/utils/octokit";
import type { User } from "@/types/user";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], token?: string) {
  const authArgs = token
    ? [
        "-c",
        `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      ]
    : [];
  const result = await execFileAsync("git", [...authArgs, ...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}

export async function getAiRunContext(runId: string) {
  const [row] = await db.select({
    run: aiRunTable,
    conversation: aiConversationTable,
    user: userTable,
  }).from(aiRunTable)
    .innerJoin(aiConversationTable, eq(aiRunTable.conversationId, aiConversationTable.id))
    .innerJoin(userTable, eq(aiConversationTable.userId, userTable.id))
    .where(eq(aiRunTable.id, runId)).limit(1);
  if (!row) throw createHttpError("AI run not found.", 404);
  return {
    ...row,
    user: row.user as User,
    scope: {
      owner: row.conversation.owner,
      repo: row.conversation.repo,
      branch: row.conversation.branch,
    },
  };
}

export async function getRepositoryContext(runId: string, workspacePath: string) {
  const context = await getAiRunContext(runId);
  if (context.run.workspacePath !== workspacePath) throw new Error("Workspace does not match this run.");
  const status = await git(workspacePath, ["status", "--short"]);
  const headSha = await git(workspacePath, ["rev-parse", "HEAD"]);
  return {
    repository: `${context.scope.owner}/${context.scope.repo}`,
    branch: context.scope.branch,
    baseSha: context.run.baseSha,
    headSha,
    hasUncommittedChanges: Boolean(status),
    changedFiles: status ? status.split("\n") : [],
    rules: {
      publish: "Commits directly to the selected branch and automatically starts a preview deployment.",
      production: "Always requires explicit user approval and is pinned to the approved commit SHA.",
    },
  };
}

export async function refreshRepository(runId: string, workspacePath: string) {
  const context = await getAiRunContext(runId);
  const status = await git(workspacePath, ["status", "--porcelain"]);
  if (status) throw createHttpError("Commit or discard workspace changes before refreshing.", 409);
  const { token } = await getToken(context.user, context.scope.owner, context.scope.repo, true);
  await git(workspacePath, ["fetch", "origin", context.scope.branch, "--depth", "1"], token);
  await git(workspacePath, ["reset", "--hard", "FETCH_HEAD"]);
  const sha = await git(workspacePath, ["rev-parse", "HEAD"]);
  await db.update(aiRunTable).set({ baseSha: sha, headSha: sha, updatedAt: new Date() })
    .where(eq(aiRunTable.id, runId));
  await appendAiEvent(runId, "repository.refreshed", { sha });
  return { sha };
}

export async function publishRepositoryChanges(runId: string, workspacePath: string, message: string) {
  const context = await getAiRunContext(runId);
  const status = await git(workspacePath, ["status", "--porcelain"]);
  if (!status) return { published: false, message: "No repository changes to publish." };
  const { token } = await getToken(context.user, context.scope.owner, context.scope.repo, true);
  const octokit = createOctokitInstance(token);
  const remote = await octokit.rest.repos.getBranch(context.scope);
  const expectedSha = context.run.headSha || context.run.baseSha;
  if (expectedSha && remote.data.commit.sha !== expectedSha) {
    throw createHttpError("The branch changed while the agent was working. Refresh before publishing.", 409);
  }

  await git(workspacePath, ["config", "user.name", context.user.name || "Pages CMS AI"]);
  await git(workspacePath, ["config", "user.email", context.user.email]);
  await git(workspacePath, ["add", "--all"]);
  await git(workspacePath, ["commit", "-m", message.slice(0, 120) || "Update site with Pages CMS AI"]);
  const sha = await git(workspacePath, ["rev-parse", "HEAD"]);
  const summary = await git(workspacePath, ["show", "--stat", "--oneline", "--format=%h %s", "HEAD"]);
  await git(workspacePath, ["push", "origin", `HEAD:refs/heads/${context.scope.branch}`], token);
  await db.update(aiRunTable).set({ headSha: sha, updatedAt: new Date() })
    .where(eq(aiRunTable.id, runId));
  await appendAiEvent(runId, "repository.published", { sha, summary });

  const preview = await triggerAiDeployment(context.user, context.scope, "deploy-preview", sha);
  await appendAiEvent(runId, "deployment.preview_started", preview);
  return { published: true, sha, summary, preview };
}

export async function currentRepositorySha(runId: string) {
  const context = await getAiRunContext(runId);
  const { token } = await getToken(context.user, context.scope.owner, context.scope.repo, true);
  const branch = await createOctokitInstance(token).rest.repos.getBranch(context.scope);
  return branch.data.commit.sha;
}

export async function getRunForCapability(conversationId: string, workspacePath: string) {
  const [run] = await db.select({ id: aiRunTable.id }).from(aiRunTable).where(and(
    eq(aiRunTable.conversationId, conversationId),
    eq(aiRunTable.workspacePath, workspacePath),
    inArray(aiRunTable.status, ["running", "waiting_approval"]),
  )).orderBy(desc(aiRunTable.createdAt)).limit(1);
  if (!run) throw new Error("No active AI run matches this capability.");
  return getAiRunContext(run.id);
}
