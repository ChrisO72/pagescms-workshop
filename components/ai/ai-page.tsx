"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  GitBranch,
  Loader2,
  Plus,
  Rocket,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentTitle, formatRepoBranchTitle } from "@/components/document-title";
import { RunActivity } from "@/components/ai/run-activity";
import { useRepoHeader } from "@/components/repo/repo-header-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/contexts/config-context";
import type { AiApproval, AiConversationSummary, AiMessage, AiRunEvent } from "@/types/ai";
import { cn } from "@/lib/utils";

type Run = {
  id: string;
  userMessageId: string;
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

type Detail = {
  conversation: AiConversationSummary;
  messages: AiMessage[];
  runs: Run[];
  approvals: AiApproval[];
  events: AiRunEvent[];
};

const activeStatuses = new Set(["queued", "running", "waiting_approval"]);

function shortModel(model: string) {
  return model.replace("gpt-5.6-", "");
}

export function AiPage() {
  const { config } = useConfig();
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const headerNode = useMemo(() => (
    <div className="flex min-w-0 items-center gap-2">
      <Sparkles className="size-4 text-primary" />
      <span className="truncate font-medium">AI Assistant</span>
      <Badge variant="secondary" className="hidden sm:inline-flex">Beta</Badge>
    </div>
  ), []);
  useRepoHeader({ header: headerNode });

  if (!config) throw new Error("Configuration not found.");
  const base = `/api/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/ai`;

  const request = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Request failed.");
    return body.data as T;
  }, []);

  const loadConversations = useCallback(async (selectFirst = false) => {
    const items = await request<AiConversationSummary[]>(`${base}/conversations`);
    setConversations(items);
    if (selectFirst) setConversationId((current) => current || items[0]?.id || null);
  }, [base, request]);

  const loadDetail = useCallback(async (id: string) => {
    const next = await request<Detail>(`${base}/conversations/${id}`);
    setDetail(next);
    return next;
  }, [base, request]);

  useEffect(() => {
    setLoading(true);
    setConversationId(null);
    setDetail(null);
    loadConversations(true).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    if (!conversationId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    loadDetail(conversationId).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, [conversationId, loadDetail]);

  const activeRun = [...(detail?.runs || [])].reverse().find((run) => activeStatuses.has(run.status));
  const activeRunId = activeRun?.id;

  useEffect(() => {
    if (!conversationId || !activeRunId) return;
    const url = `${base}/conversations/${conversationId}/runs/${activeRunId}/events`;
    const source = new EventSource(url);
    const receiveActivity = (incoming: Event) => {
      const event = JSON.parse((incoming as MessageEvent<string>).data) as AiRunEvent;
      setDetail((current) => {
        if (!current || current.events.some((candidate) => candidate.id === event.id)) return current;
        return { ...current, events: [...current.events, event] };
      });
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
        void loadDetail(conversationId);
        void loadConversations();
      } else if ([
        "repository.ready",
        "repository.published",
        "approval.requested",
        "approval.approved",
        "approval.rejected",
      ].includes(event.type)) {
        void loadDetail(conversationId);
      }
    };
    source.addEventListener("activity", receiveActivity);
    return () => source.close();
  }, [activeRunId, base, conversationId, loadConversations, loadDetail]);

  useEffect(() => {
    if (!activeRunId) return;
    const transcript = transcriptRef.current;
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
  }, [activeRunId, detail?.events.length, detail?.messages.length]);

  const createConversation = async () => {
    try {
      const item = await request<AiConversationSummary>(`${base}/conversations`, { method: "POST" });
      setConversations((current) => [item, ...current]);
      setConversationId(item.id);
      setMessage("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a conversation.");
    }
  };

  const sendMessage = async (content = message) => {
    const trimmed = content.trim();
    if (!trimmed || sending || activeRun) return;
    setSending(true);
    try {
      let id = conversationId;
      if (!id) {
        const item = await request<AiConversationSummary>(`${base}/conversations`, { method: "POST" });
        id = item.id;
        setConversationId(id);
      }
      setMessage("");
      await request(`${base}/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      await Promise.all([loadDetail(id), loadConversations()]);
    } catch (error) {
      setMessage(trimmed);
      toast.error(error instanceof Error ? error.message : "Could not send the message.");
    } finally {
      setSending(false);
    }
  };

  const decideApproval = async (approval: AiApproval, decision: "approved" | "rejected") => {
    if (!conversationId) return;
    try {
      await request(`${base}/conversations/${conversationId}/runs/${approval.runId}/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      await loadDetail(conversationId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the decision.");
    }
  };

  const cancelRun = async () => {
    if (!conversationId || !activeRun) return;
    try {
      await request(`${base}/conversations/${conversationId}/runs/${activeRun.id}/cancel`, { method: "POST" });
      await loadDetail(conversationId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop the run.");
    }
  };

  const lastUserMessage = [...(detail?.messages || [])].reverse().find((item) => item.role === "user");

  return (
    <>
      <DocumentTitle title={formatRepoBranchTitle("AI Assistant", config.owner, config.repo, config.branch)} />
      <div className="mx-auto flex h-[calc(100svh-7rem)] min-h-[32rem] w-full max-w-6xl overflow-hidden rounded-xl border bg-background">
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/20 md:flex">
          <div className="p-3">
            <Button variant="outline" className="w-full justify-start" onClick={createConversation}>
              <Plus /> New conversation
            </Button>
          </div>
          <Separator />
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {conversations.map((conversation) => (
              <Button
                key={conversation.id}
                variant={conversation.id === conversationId ? "secondary" : "ghost"}
                className="h-auto w-full justify-start px-3 py-2 text-left"
                onClick={() => setConversationId(conversation.id)}
              >
                <span className="truncate">{conversation.title}</span>
              </Button>
            ))}
          </div>
          <div className="border-t p-3 text-xs text-muted-foreground">Conversations are private to you.</div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Button size="sm" variant="outline" className="md:hidden" onClick={createConversation}>
              <Plus /> New
            </Button>
            <select
              aria-label="Conversation"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm md:hidden"
              value={conversationId || ""}
              onChange={(event) => setConversationId(event.target.value || null)}
            >
              <option value="">New conversation</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
              ))}
            </select>
            <Badge variant="outline" className="ml-auto hidden max-w-full gap-1.5 font-normal text-muted-foreground sm:flex">
              <GitBranch className="size-3" />
              <span className="truncate">{config.owner}/{config.repo}</span>
              <span>·</span>
              <span className="truncate">{config.branch}</span>
            </Badge>
          </div>

          <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
            {loading && !detail ? (
              <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : !detail?.messages.length ? (
              <Empty className="h-full border-0">
                <EmptyHeader>
                  <Avatar className="mx-auto size-12 border bg-primary/10">
                    <AvatarFallback className="bg-primary/10 text-primary"><Bot className="size-6" /></AvatarFallback>
                  </Avatar>
                  <EmptyTitle>What would you like to change?</EmptyTitle>
                  <EmptyDescription>Ask the agent to inspect or update code, publish changes, or manage a deployment.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6">
                {detail.messages.map((item) => {
                  const run = detail.runs.find((candidate) => candidate.userMessageId === item.id);
                  return (
                    <Fragment key={item.id}>
                      <div className={cn("flex", item.role === "user" ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                          item.role === "user" ? "bg-primary text-primary-foreground" : "border bg-card",
                        )}>
                          <div className="whitespace-pre-wrap break-words">{item.content}</div>
                          {run && (
                            <div className={cn(
                              "mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2 text-xs",
                              item.role === "user" ? "border-primary-foreground/20 text-primary-foreground/70" : "text-muted-foreground",
                            )}>
                              <Badge variant="secondary" className="capitalize">{shortModel(run.model)}</Badge>
                              <span>{run.effort} effort</span><span>·</span><span>{run.rationale}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {run && (
                        <RunActivity
                          run={run}
                          events={detail.events.filter((event) => event.runId === run.id)}
                        />
                      )}
                    </Fragment>
                  );
                })}

                {detail.approvals.filter((approval) => approval.status === "pending").map((approval) => (
                  <div key={approval.id} className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                    <div className="flex items-start gap-3">
                      <Rocket className="mt-0.5 size-5 text-amber-600" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <p className="font-medium">Approve production deployment?</p>
                          <p className="text-sm text-muted-foreground">
                            Commit <span className="font-mono">{approval.requestedSha.slice(0, 7)}</span> will be deployed to production.
                          </p>
                        </div>
                        <p className="text-sm">{String(approval.details.reason || "The agent requested a production deployment.")}</p>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => decideApproval(approval, "approved")}>Approve deploy</Button>
                          <Button size="sm" variant="outline" onClick={() => decideApproval(approval, "rejected")}>Reject</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {activeRun && (
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={cancelRun}><Square className="size-3 fill-current" /> Stop agent</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t bg-background p-3 sm:p-4">
            <div className="mx-auto max-w-3xl space-y-2">
              <InputGroup className="items-end rounded-xl bg-background shadow-sm">
                <InputGroupTextarea
                  aria-label="Message the AI assistant"
                  placeholder="Ask the agent to update your site..."
                  rows={2}
                  value={message}
                  disabled={Boolean(activeRun) || sending}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  className="min-h-20 max-h-40"
                />
                <InputGroupAddon align="block-end" className="justify-end pt-0">
                  <Button size="icon-sm" aria-label="Send message" disabled={!message.trim() || Boolean(activeRun) || sending} onClick={() => sendMessage()}>
                    {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                  </Button>
                </InputGroupAddon>
              </InputGroup>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Commits go to {config.branch}; successful commits automatically get a preview.</span>
                {!activeRun && lastUserMessage && detail?.runs.at(-1)?.status === "failed" && (
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => sendMessage(lastUserMessage.content)}>Retry</Button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
