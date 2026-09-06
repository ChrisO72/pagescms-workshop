import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionRunTable } from "@/db/schema";
import { getRootActions, resolveActionRef } from "@/lib/actions";
import { fetchAiRepositoryConfig } from "@/lib/ai/repository-config";
import { createHttpError } from "@/lib/api-error";
import { getToken } from "@/lib/token";
import { createOctokitInstance } from "@/lib/utils/octokit";
import type { User } from "@/types/user";

export type AiRepositoryScope = { owner: string; repo: string; branch: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findDispatchedWorkflowRun(
  octokit: ReturnType<typeof createOctokitInstance>,
  scope: AiRepositoryScope,
  workflow: string,
  workflowRef: string,
  startedAt: Date,
) {
  const claimed = new Set(
    (
      await db
        .select({ id: actionRunTable.workflowRunId })
        .from(actionRunTable)
        .where(
          and(
            eq(actionRunTable.owner, scope.owner),
            eq(actionRunTable.repo, scope.repo),
            eq(actionRunTable.workflow, workflow),
          ),
        )
    )
      .map((row) => row.id)
      .filter((id): id is number => typeof id === "number"),
  );
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await octokit.rest.actions.listWorkflowRuns({
      owner: scope.owner,
      repo: scope.repo,
      workflow_id: workflow,
      branch: workflowRef,
      event: "workflow_dispatch",
      per_page: 10,
    });
    const candidate = response.data.workflow_runs.find(
      (item) =>
        Date.parse(item.created_at) >= startedAt.getTime() - 30_000 &&
        !claimed.has(item.id),
    );
    if (candidate) return candidate;
    await sleep(1500);
  }
  return null;
}

export async function triggerAiDeployment(
  user: User,
  scope: AiRepositoryScope,
  actionName: "deploy-preview" | "deploy",
  expectedSha?: string,
) {
  const { token } = await getToken(user, scope.owner, scope.repo, true);
  const octokit = createOctokitInstance(token);
  const config = await fetchAiRepositoryConfig(octokit, scope);
  const action = getRootActions(config).find(
    (item) => item.name === actionName,
  );
  if (!action?.workflow) {
    throw createHttpError(
      `The root action "${actionName}" is not configured.`,
      400,
    );
  }

  const branch = await octokit.rest.repos.getBranch(scope);
  const sha = branch.data.commit.sha;
  if (expectedSha && expectedSha !== sha) {
    throw createHttpError(
      "The branch changed after deployment approval. Request a new approval.",
      409,
    );
  }

  const workflowRef = resolveActionRef(action.ref, scope.branch);
  const now = new Date();
  const triggeredBy = {
    userId: user.id,
    name: user.name,
    email: user.email,
    githubUsername: user.githubUsername ?? null,
    image: user.image ?? null,
  };
  const payload = {
    source: "pages-cms-ai",
    action: {
      name: action.name,
      label: action.label,
      cancelable: action.cancelable !== false,
    },
    repository: { ...scope, ref: scope.branch, workflowRef, sha },
    triggeredAt: now.toISOString(),
    triggeredBy,
    context: {
      type: "repository",
      name: null,
      path: null,
      data: { source: "ai" },
    },
    inputs: {},
  };

  const [run] = await db
    .insert(actionRunTable)
    .values({
      owner: scope.owner,
      repo: scope.repo,
      ref: scope.branch,
      workflowRef,
      sha,
      actionName: action.name,
      contextType: "repository",
      workflow: action.workflow,
      status: "dispatching",
      triggeredBy,
      payload,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  try {
    await octokit.rest.actions.createWorkflowDispatch({
      owner: scope.owner,
      repo: scope.repo,
      workflow_id: action.workflow,
      ref: workflowRef,
      inputs: { payload: JSON.stringify(payload) },
    });
    const workflowRun = await findDispatchedWorkflowRun(
      octokit,
      scope,
      action.workflow,
      workflowRef,
      now,
    );
    await db
      .update(actionRunTable)
      .set({
        workflowRunId: workflowRun?.id,
        status: workflowRun?.status ?? "queued",
        conclusion: workflowRun?.conclusion,
        htmlUrl: workflowRun?.html_url,
        updatedAt: new Date(),
      })
      .where(eq(actionRunTable.id, run.id));
  } catch (error) {
    await db
      .update(actionRunTable)
      .set({
        status: "completed",
        conclusion: "failure",
        failure: {
          message: error instanceof Error ? error.message : "Dispatch failed.",
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(actionRunTable.id, run.id));
    throw error;
  }

  const [updated] = await db
    .select()
    .from(actionRunTable)
    .where(eq(actionRunTable.id, run.id))
    .limit(1);
  return {
    id: run.id,
    actionName: action.name,
    sha,
    status: updated?.status ?? "queued",
    htmlUrl: updated?.htmlUrl ?? null,
  };
}

export async function listAiDeployments(user: User, scope: AiRepositoryScope) {
  await getToken(user, scope.owner, scope.repo, true);
  return db
    .select()
    .from(actionRunTable)
    .where(
      and(
        eq(actionRunTable.owner, scope.owner),
        eq(actionRunTable.repo, scope.repo),
        eq(actionRunTable.ref, scope.branch),
      ),
    )
    .orderBy(desc(actionRunTable.createdAt))
    .limit(20);
}

export async function getAiDeployment(
  user: User,
  scope: AiRepositoryScope,
  id: number,
) {
  const { token } = await getToken(user, scope.owner, scope.repo, true);
  const [run] = await db
    .select()
    .from(actionRunTable)
    .where(
      and(
        eq(actionRunTable.id, id),
        eq(actionRunTable.owner, scope.owner),
        eq(actionRunTable.repo, scope.repo),
        eq(actionRunTable.ref, scope.branch),
      ),
    )
    .limit(1);
  if (!run) throw createHttpError("Deployment not found.", 404);
  if (!run.workflowRunId) return run;

  const response = await createOctokitInstance(
    token,
  ).rest.actions.getWorkflowRun({
    owner: scope.owner,
    repo: scope.repo,
    run_id: run.workflowRunId,
  });
  const [updated] = await db
    .update(actionRunTable)
    .set({
      status: response.data.status ?? run.status,
      conclusion: response.data.conclusion,
      htmlUrl: response.data.html_url,
      completedAt:
        response.data.status === "completed"
          ? new Date(response.data.updated_at)
          : null,
      updatedAt: new Date(),
    })
    .where(eq(actionRunTable.id, id))
    .returning();
  return updated ?? run;
}

export async function getAiDeploymentJobs(
  user: User,
  scope: AiRepositoryScope,
  id: number,
) {
  const run = await getAiDeployment(user, scope, id);
  if (!run.workflowRunId) return { run, jobs: [] };
  const { token } = await getToken(user, scope.owner, scope.repo, true);
  const response = await createOctokitInstance(
    token,
  ).rest.actions.listJobsForWorkflowRun({
    owner: scope.owner,
    repo: scope.repo,
    run_id: run.workflowRunId,
  });
  return { run, jobs: response.data.jobs };
}

export async function cancelAiDeployment(
  user: User,
  scope: AiRepositoryScope,
  id: number,
) {
  const run = await getAiDeployment(user, scope, id);
  if (!run.workflowRunId)
    throw createHttpError("The deployment has not started on GitHub yet.", 409);
  const { token } = await getToken(user, scope.owner, scope.repo, true);
  await createOctokitInstance(token).rest.actions.cancelWorkflowRun({
    owner: scope.owner,
    repo: scope.repo,
    run_id: run.workflowRunId,
  });
  return { id, status: "cancellation_requested" };
}
