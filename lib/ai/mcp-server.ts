import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiApprovalTable, aiRunTable } from "@/db/schema";
import { verifyAiCapability } from "@/lib/ai/capability";
import {
  cancelAiDeployment,
  getAiDeployment,
  getAiDeploymentJobs,
  listAiDeployments,
  triggerAiDeployment,
} from "@/lib/ai/deployments";
import {
  currentRepositorySha,
  getAiRunContext,
  getRepositoryContext,
  getRunForCapability,
  publishRepositoryChanges,
  refreshRepository,
} from "@/lib/ai/repository";
import { appendAiEvent } from "@/lib/ai/store";

async function startServer() {
  const capability = verifyAiCapability(
    process.env.PAGESCMS_AI_CAPABILITY || "",
  );
  await getRunForCapability(capability.runId, capability.workspacePath);

  const server = new McpServer({ name: "pagescms", version: "1.0.0" });
  const json = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });

  server.registerTool(
    "repository_context",
    {
      description:
        "Get the fixed repository, branch, current SHA, workspace status, and publication rules for this run.",
      inputSchema: {},
    },
    async () =>
      json(
        await getRepositoryContext(capability.runId, capability.workspacePath),
      ),
  );

  server.registerTool(
    "repository_refresh",
    {
      description:
        "Refresh the disposable workspace from its fixed remote branch. Refuses when local changes exist.",
      inputSchema: {},
    },
    async () =>
      json(await refreshRepository(capability.runId, capability.workspacePath)),
  );

  server.registerTool(
    "repository_publish_changes",
    {
      description:
        "Commit all workspace changes directly to the fixed branch, push without force, then automatically start a preview deployment.",
      inputSchema: {
        message: z
          .string()
          .min(1)
          .max(120)
          .describe("Concise Git commit message"),
      },
    },
    async ({ message }) =>
      json(
        await publishRepositoryChanges(
          capability.runId,
          capability.workspacePath,
          message,
        ),
      ),
  );

  server.registerTool(
    "deployment_preview",
    {
      description:
        "Start the configured deploy-preview root action for the latest commit. No confirmation is needed.",
      inputSchema: {},
    },
    async () => {
      const context = await getAiRunContext(capability.runId);
      return json(
        await triggerAiDeployment(
          context.user,
          context.scope,
          "deploy-preview",
        ),
      );
    },
  );

  server.registerTool(
    "deployment_production",
    {
      description:
        "Request explicit user approval, then deploy the exact approved commit with the configured deploy root action. This call waits for the decision.",
      inputSchema: { reason: z.string().min(1).max(300) },
    },
    async ({ reason }) => {
      const context = await getAiRunContext(capability.runId);
      const requestedSha = await currentRepositorySha(capability.runId);
      const approvalId = crypto.randomUUID();
      await db.insert(aiApprovalTable).values({
        id: approvalId,
        runId: capability.runId,
        kind: "production_deploy",
        requestedSha,
        details: {
          reason,
          repository: `${context.scope.owner}/${context.scope.repo}`,
          branch: context.scope.branch,
        },
      });
      await db
        .update(aiRunTable)
        .set({ status: "waiting_approval", updatedAt: new Date() })
        .where(eq(aiRunTable.id, capability.runId));
      await appendAiEvent(capability.runId, "approval.requested", {
        approvalId,
        requestedSha,
        reason,
      });

      const deadline = Date.now() + 30 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const [approval] = await db
          .select()
          .from(aiApprovalTable)
          .where(eq(aiApprovalTable.id, approvalId))
          .limit(1);
        const [run] = await db
          .select()
          .from(aiRunTable)
          .where(eq(aiRunTable.id, capability.runId))
          .limit(1);
        if (run?.status === "cancelled")
          throw new Error("The AI run was cancelled.");
        if (approval?.status === "rejected")
          throw new Error(
            "The production deployment was rejected by the user.",
          );
        if (approval?.status === "approved") {
          await db
            .update(aiRunTable)
            .set({ status: "running", updatedAt: new Date() })
            .where(eq(aiRunTable.id, capability.runId));
          const deployment = await triggerAiDeployment(
            context.user,
            context.scope,
            "deploy",
            requestedSha,
          );
          await appendAiEvent(
            capability.runId,
            "deployment.production_started",
            deployment,
          );
          return json(deployment);
        }
      }
      throw new Error("Production deployment approval timed out.");
    },
  );

  server.registerTool(
    "deployment_list",
    {
      description:
        "List recent deployments for the fixed repository and branch.",
      inputSchema: {},
    },
    async () => {
      const context = await getAiRunContext(capability.runId);
      return json(await listAiDeployments(context.user, context.scope));
    },
  );

  server.registerTool(
    "deployment_status",
    {
      description: "Get and refresh a deployment's GitHub Actions status.",
      inputSchema: { id: z.number().int().positive() },
    },
    async ({ id }) => {
      const context = await getAiRunContext(capability.runId);
      return json(await getAiDeployment(context.user, context.scope, id));
    },
  );

  server.registerTool(
    "deployment_logs",
    {
      description:
        "Get a deployment's jobs, steps, conclusions, and GitHub URL for diagnostics.",
      inputSchema: { id: z.number().int().positive() },
    },
    async ({ id }) => {
      const context = await getAiRunContext(capability.runId);
      return json(await getAiDeploymentJobs(context.user, context.scope, id));
    },
  );

  server.registerTool(
    "deployment_cancel",
    {
      description: "Cancel an active GitHub Actions deployment.",
      inputSchema: { id: z.number().int().positive() },
    },
    async ({ id }) => {
      const context = await getAiRunContext(capability.runId);
      return json(await cancelAiDeployment(context.user, context.scope, id));
    },
  );

  await server.connect(new StdioServerTransport());
}

void startServer().catch(async (error) => {
  const detail =
    error instanceof Error ? error.stack || error.message : String(error);
  const diagnosticsPath = process.env.PAGESCMS_AI_MCP_DIAGNOSTICS;
  if (diagnosticsPath) {
    try {
      await writeFile(diagnosticsPath, detail.slice(0, 12_000), {
        mode: 0o600,
      });
    } catch {}
  }
  console.error(`[pagescms-mcp] ${detail}`);
  process.exitCode = 1;
  process.stdin.destroy();
});
