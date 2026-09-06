"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Code2,
  FilePenLine,
  GitCommit,
  Globe2,
  Loader2,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AiRunEvent } from "@/types/ai";

type Run = {
  id: string;
  model: string;
  effort: string;
  rationale: string;
  status: string;
  baseSha: string | null;
  headSha: string | null;
  failure: { message?: string } | null;
  createdAt: string;
  completedAt: string | null;
};

type Activity = {
  id: number;
  key: string;
  type: string;
  data: Record<string, any>;
};

type ActivityPresentation = {
  icon: typeof CircleDot;
  title: string;
  detail: unknown;
  output?: unknown;
  failed?: boolean;
};

const terminal = new Set(["completed", "failed", "cancelled"]);

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function buildActivities(events: AiRunEvent[]) {
  const entries: Activity[] = [];
  const indexes = new Map<string, number>();
  const completedItems = new Set(
    events.filter((event) => event.type === "item/completed")
      .map((event) => String(event.data.itemId || "")),
  );

  for (const event of events) {
    if (["agent.delta", "agent.final", "message.delta", "run.completed", "run.failed", "run.cancelled"].includes(event.type)) continue;
    const itemId = String(event.data.itemId || "");
    if (event.type === "command.output" && completedItems.has(itemId)) continue;
    const mergeableDelta = ["reasoning.delta", "plan.delta", "command.output"].includes(event.type);
    const key = event.type.startsWith("item/")
      ? `item:${itemId}`
      : mergeableDelta
        ? `${event.type}:${itemId}`
        : `${event.type}:${event.id}`;
    const existingIndex = indexes.get(key);
    if (existingIndex != null) {
      const existing = entries[existingIndex];
      entries[existingIndex] = {
        ...existing,
        type: event.type,
        data: mergeableDelta
          ? { ...event.data, delta: `${existing.data.delta || ""}${event.data.delta || ""}` }
          : event.data,
      };
    } else {
      indexes.set(key, entries.length);
      entries.push({ id: event.id, key, type: event.type, data: event.data });
    }
  }
  return entries.sort((left, right) => left.id - right.id);
}

function activityPresentation(activity: Activity): ActivityPresentation {
  const { type, data } = activity;
  if (type === "run.started") return { icon: Sparkles, title: "Started agent", detail: null };
  if (type === "repository.cloning") return { icon: GitCommit, title: "Cloning repository", detail: null };
  if (type === "repository.ready") return { icon: GitCommit, title: "Prepared repository", detail: `Checked out ${data.branch}` };
  if (type === "runtime.starting") return { icon: Loader2, title: "Starting Codex runtime", detail: null };
  if (type === "runtime.authenticated") return { icon: CheckCircle2, title: "Connected to OpenAI", detail: null };
  if (type === "mcp.starting") return { icon: Wrench, title: "Connecting Pages CMS tools", detail: null };
  if (type === "mcp.ready") return { icon: Wrench, title: "Pages CMS tools ready", detail: `${Array.isArray(data.tools) ? data.tools.length : 0} tools available` };
  if (type === "turn.starting") return { icon: Sparkles, title: "Sending task to agent", detail: `${data.model} · ${data.effort} effort` };
  if (type === "turn.started") return { icon: Sparkles, title: "Agent began working", detail: null };
  if (type === "mcp.status") return {
    icon: data.status === "failed" ? AlertCircle : Wrench,
    title: `Pages CMS MCP ${data.status || "updated"}`,
    detail: data.error || data.failureReason || null,
  };
  if (type === "reasoning.delta") return { icon: CircleDot, title: "Thinking", detail: data.delta };
  if (type === "plan.delta") return { icon: CircleDot, title: "Planning", detail: data.delta };
  if (type === "agent.commentary") return { icon: Sparkles, title: "Agent update", detail: data.text };
  if (type === "mcp.progress") return { icon: Wrench, title: "Tool progress", detail: data.message };
  if (type === "runtime.stderr" || type === "runtime.error") return {
    icon: AlertCircle,
    title: type === "runtime.error" ? "Agent error" : "Runtime notice",
    detail: data.message || data.detail,
  };
  if (type === "repository.published") return { icon: GitCommit, title: "Published changes", detail: data.sha ? String(data.sha).slice(0, 7) : null };
  if (type === "repository.refreshed") return { icon: GitCommit, title: "Refreshed repository", detail: data.sha ? String(data.sha).slice(0, 7) : null };
  if (type === "deployment.preview_started") return { icon: Rocket, title: "Started preview deployment", detail: data.sha ? String(data.sha).slice(0, 7) : null };
  if (type === "deployment.production_started") return { icon: Rocket, title: "Started production deployment", detail: data.sha ? String(data.sha).slice(0, 7) : null };
  if (type === "approval.requested") return { icon: Rocket, title: "Requested production approval", detail: data.reason };

  if (type.startsWith("item/") && data.type === "commandExecution") return {
    icon: Code2,
    title: data.status === "completed" ? "Ran command" : "Running command",
    detail: data.command,
    output: data.output,
    failed: data.exitCode != null && data.exitCode !== 0,
  };
  if (type.startsWith("item/") && data.type === "fileChange") return {
    icon: FilePenLine,
    title: data.status === "completed" ? "Updated files" : "Updating files",
    detail: Array.isArray(data.changes)
      ? data.changes.map((change: Record<string, string>) => `${change.kind}: ${change.path}`).join("\n")
      : null,
  };
  if (type.startsWith("item/") && data.type === "mcpToolCall") return {
    icon: Wrench,
    title: data.status === "completed" ? `Used ${data.tool}` : `Using ${data.tool}`,
    detail: data.error?.message || null,
    failed: Boolean(data.error),
  };
  if (type.startsWith("item/") && data.type === "webSearch") return {
    icon: Globe2,
    title: "Searched the web",
    detail: data.query,
  };
  if (type === "command.output") return { icon: Code2, title: "Command output", detail: data.delta };
  return { icon: CircleDot, title: type.replaceAll(".", " ").replaceAll("/", " "), detail: null };
}

export function RunActivity({ run, events }: { run: Run; events: AiRunEvent[] }) {
  const [now, setNow] = useState(0);
  const isActive = !terminal.has(run.status);
  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);
  const activities = useMemo(() => buildActivities(events), [events]);
  const liveText = useMemo(() => {
    const completedAgentItems = new Set(
      events.filter((event) => ["agent.commentary", "agent.final"].includes(event.type))
        .map((event) => String(event.data.itemId || "")),
    );
    return events.filter((event) => (
      event.type === "agent.delta" && !completedAgentItems.has(String(event.data.itemId || ""))
    )).map((event) => String(event.data.delta || "")).join("");
  }, [events]);
  const endedAt = run.completedAt ? new Date(run.completedAt).getTime() : now;
  const duration = formatDuration(endedAt - new Date(run.createdAt).getTime());
  const statusLabel = run.status === "completed" ? "Finished successfully"
    : run.status === "waiting_approval" ? "Waiting for approval"
      : run.status === "failed" ? "Failed"
        : run.status === "cancelled" ? "Stopped"
          : run.status === "queued" ? "Queued"
            : "Working";

  return (
    <div className="rounded-xl border bg-muted/10">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        {run.status === "completed" ? <CheckCircle2 className="size-4 text-green-600" />
          : run.status === "failed" ? <AlertCircle className="size-4 text-destructive" />
            : isActive ? <Loader2 className="size-4 animate-spin text-primary" />
              : <CircleDot className="size-4" />}
        <span className="text-sm font-medium">{statusLabel}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{duration}</span>
        <Badge variant="outline" className="ml-auto capitalize">{run.model.replace("gpt-5.6-", "")}</Badge>
      </div>
      <div className="space-y-1 p-3">
        {activities.map((activity) => {
          const presentation = activityPresentation(activity);
          const Icon = presentation.icon;
          return (
            <div key={activity.key} className="group flex gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted/50">
              <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", presentation.failed && "text-destructive")} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{presentation.title}</p>
                {presentation.detail && (
                  <p className={cn(
                    "mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground",
                    activity.data.type === "commandExecution" && "font-mono",
                  )}>{String(presentation.detail)}</p>
                )}
                {presentation.output && (
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="flex cursor-pointer list-none items-center gap-1"><ChevronRight className="size-3" /> View output</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-background p-2 whitespace-pre-wrap">{String(presentation.output)}</pre>
                  </details>
                )}
              </div>
            </div>
          );
        })}
        {liveText && (
          <div className="flex gap-3 rounded-lg bg-primary/5 px-2 py-2 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Agent</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{liveText}</p>
            </div>
          </div>
        )}
        {activities.length === 0 && isActive && <p className="px-2 py-1 text-xs text-muted-foreground">Starting the agent…</p>}
        {run.failure?.message && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{run.failure.message}</p>}
      </div>
    </div>
  );
}
