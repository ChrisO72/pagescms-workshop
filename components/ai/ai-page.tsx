"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  FileText,
  GitBranch,
  ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Rocket,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { DocumentTitle, formatRepoBranchTitle } from "@/components/document-title";
import { getOttoState, OttoPortrait, OttoStatus } from "@/components/ai/otto-portrait";
import { RunActivity } from "@/components/ai/run-activity";
import { useRepoHeader } from "@/components/repo/repo-header-context";
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
import {
  AI_ATTACHMENT_ACCEPT,
  AI_ATTACHMENT_MAX_BYTES,
  AI_ATTACHMENT_MAX_FILES,
  type AiApproval,
  type AiAttachment,
  type AiConversationSummary,
  type AiMessage,
  type AiRunEvent,
} from "@/types/ai";

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

type ConversationListState = {
  items: AiConversationSummary[];
  activeConversationId: string | null;
};

class AiRequestError extends Error {
  code?: string;
  details?: Record<string, unknown>;

  constructor(body: { message?: string; code?: string; details?: Record<string, unknown> }) {
    super(body.message || "Request failed.");
    this.code = body.code;
    this.details = body.details;
  }
}

const activeStatuses = new Set(["queued", "running", "waiting_approval"]);

function shortModel(model: string) {
  return model.replace("gpt-5.6-", "");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedFile(file: File) {
  if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) return true;
  const extension = file.name.toLowerCase().split(".").at(-1);
  return Boolean(extension && AI_ATTACHMENT_ACCEPT.split(",").includes(`.${extension}`));
}

function PendingFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="flex max-w-52 items-center gap-2 rounded-md border bg-muted/30 p-1.5 pr-2 text-xs">
      {preview ? <Image unoptimized src={preview} alt="" width={28} height={28} className="size-7 rounded object-cover" />
        : <FileText className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{file.name}</span>
        <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
      </span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="rounded p-0.5 hover:bg-muted">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function AiPage() {
  const { config } = useConfig();
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [reusedAttachments, setReusedAttachments] = useState<AiAttachment[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isPinnedToBottomRef = useRef(true);

  const headerNode = useMemo(() => (
    <div className="flex min-w-0 items-center gap-2">
      <Sparkles className="size-4 text-primary" />
      <span className="truncate font-medium">Ask Otto</span>
      <Badge variant="secondary" className="hidden sm:inline-flex">Beta</Badge>
    </div>
  ), []);
  useRepoHeader({ header: headerNode });

  if (!config) throw new Error("Configuration not found.");
  const base = `/api/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/ai`;

  const request = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new AiRequestError(body);
    return body.data as T;
  }, []);

  const loadConversations = useCallback(async (selectFirst = false) => {
    const state = await request<ConversationListState>(`${base}/conversations`);
    setConversations(state.items);
    setActiveConversationId(state.activeConversationId);
    if (selectFirst) {
      setConversationId((current) => (
        state.activeConversationId || current || state.items[0]?.id || null
      ));
    }
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
    isPinnedToBottomRef.current = true;
    setLoading(true);
    loadDetail(conversationId).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, [conversationId, loadDetail]);

  const activeRun = [...(detail?.runs || [])].reverse().find((run) => activeStatuses.has(run.status));
  const activeRunId = activeRun?.id;
  const scopeBusy = Boolean(activeConversationId);
  const ottoState = getOttoState(Boolean(activeRun));

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

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || !isPinnedToBottomRef.current) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [conversationId, detail]);

  const updateScrollPin = () => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom <= 48;
  };

  const selectedBytes = pendingFiles.reduce((total, file) => total + file.size, 0)
    + reusedAttachments.reduce((total, attachment) => total + attachment.sizeBytes, 0);

  const addFiles = (incoming: File[]) => {
    if (scopeBusy || sending) return;
    const accepted = incoming.filter(isAcceptedFile);
    if (accepted.length !== incoming.length) {
      toast.error("Otto currently accepts PNG, JPEG, WebP, and plain-text or code files.");
    }
    const unique = accepted.filter((file) => !pendingFiles.some((current) => (
      current.name === file.name && current.size === file.size && current.lastModified === file.lastModified
    )));
    if (pendingFiles.length + reusedAttachments.length + unique.length > AI_ATTACHMENT_MAX_FILES) {
      toast.error(`Attach up to ${AI_ATTACHMENT_MAX_FILES} files per message.`);
      return;
    }
    const incomingBytes = unique.reduce((total, file) => total + file.size, 0);
    if (selectedBytes + incomingBytes > AI_ATTACHMENT_MAX_BYTES) {
      toast.error("Attachments can total at most 4 MiB per message.");
      return;
    }
    setPendingFiles((current) => [...current, ...unique]);
  };

  const reuseAttachment = (attachment: AiAttachment) => {
    if (scopeBusy || sending || reusedAttachments.some((current) => current.id === attachment.id)) return;
    if (pendingFiles.length + reusedAttachments.length >= AI_ATTACHMENT_MAX_FILES) {
      toast.error(`Attach up to ${AI_ATTACHMENT_MAX_FILES} files per message.`);
      return;
    }
    if (selectedBytes + attachment.sizeBytes > AI_ATTACHMENT_MAX_BYTES) {
      toast.error("Attachments can total at most 4 MiB per message.");
      return;
    }
    setReusedAttachments((current) => [...current, attachment]);
  };

  const createConversation = async (discardUnpublished = false) => {
    if (scopeBusy || sending) return;
    try {
      const item = await request<AiConversationSummary>(`${base}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discardUnpublished }),
      });
      setConversations((current) => [item, ...current]);
      setConversationId(item.id);
      setMessage("");
      setPendingFiles([]);
      setReusedAttachments([]);
    } catch (error) {
      if (
        error instanceof AiRequestError
        && error.code === "AI_UNPUBLISHED_CHANGES"
        && !discardUnpublished
        && window.confirm(`${error.message}\n\nDiscard these changes and start a new chat?`)
      ) {
        await createConversation(true);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not create a conversation.");
    }
  };

  const sendMessage = async (
    content = message,
    retryAttachments?: AiAttachment[],
    discardUnpublished = false,
  ) => {
    const trimmed = content.trim();
    const filesToSend = pendingFiles;
    const attachmentsToReuse = retryAttachments ?? reusedAttachments;
    if ((!trimmed && filesToSend.length === 0 && attachmentsToReuse.length === 0) || sending || scopeBusy) return;
    setSending(true);
    try {
      let id = conversationId;
      if (!id) {
        const item = await request<AiConversationSummary>(`${base}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discardUnpublished }),
        });
        id = item.id;
        setConversationId(id);
      }
      const form = new FormData();
      form.set("content", trimmed);
      if (discardUnpublished) form.set("discardUnpublished", "true");
      filesToSend.forEach((file) => form.append("files", file));
      attachmentsToReuse.forEach((attachment) => form.append("attachmentIds", attachment.id));
      await request(`${base}/conversations/${id}/messages`, {
        method: "POST",
        body: form,
      });
      setMessage("");
      setPendingFiles([]);
      setReusedAttachments([]);
      await Promise.all([loadDetail(id), loadConversations()]);
    } catch (error) {
      if (
        error instanceof AiRequestError
        && error.code === "AI_UNPUBLISHED_CHANGES"
        && !discardUnpublished
        && window.confirm(`${error.message}\n\nDiscard these changes and continue in this chat?`)
      ) {
        setSending(false);
        await sendMessage(trimmed, attachmentsToReuse, true);
        return;
      }
      setMessage(trimmed);
      setPendingFiles(filesToSend);
      setReusedAttachments(attachmentsToReuse);
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
      await Promise.all([loadDetail(conversationId), loadConversations()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop the run.");
    }
  };

  const lastUserMessage = [...(detail?.messages || [])].reverse().find((item) => item.role === "user");

  return (
    <>
      <DocumentTitle title={formatRepoBranchTitle("Ask Otto", config.owner, config.repo, config.branch)} />
      <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/20 md:flex">
          <div className="p-3">
            <Button variant="outline" className="w-full justify-start" disabled={scopeBusy || sending} onClick={() => createConversation()}>
              <Plus /> New chat
            </Button>
          </div>
          <Separator />
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {conversations.map((conversation) => (
              <Button
                key={conversation.id}
                variant={conversation.id === conversationId ? "secondary" : "ghost"}
                className="h-auto w-full justify-start px-3 py-2 text-left"
                disabled={scopeBusy || sending}
                onClick={() => setConversationId(conversation.id)}
              >
                <span className="truncate">{conversation.title}</span>
              </Button>
            ))}
          </div>
          <div className="border-t p-3 text-xs text-muted-foreground">Conversations are private to you.</div>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Button size="sm" variant="outline" className="md:hidden" disabled={scopeBusy || sending} onClick={() => createConversation()}>
              <Plus /> New
            </Button>
            <select
              aria-label="Conversation"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm md:hidden"
              value={conversationId || ""}
              disabled={scopeBusy || sending}
              onChange={(event) => setConversationId(event.target.value || null)}
            >
              <option value="">New chat</option>
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

          {detail?.messages.length ? (
            <OttoStatus state={ottoState} className="absolute right-4 top-16 z-20 sm:right-6 sm:top-20" />
          ) : null}

          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto p-4 [overflow-anchor:auto] sm:p-6"
            onScroll={updateScrollPin}
          >
            {loading && !detail ? (
              <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : !detail?.messages.length ? (
              <Empty className="h-full border-0">
                <EmptyHeader>
                  <OttoPortrait state="ready" size="hero" />
                  <EmptyTitle>What can Otto fix for you?</EmptyTitle>
                  <EmptyDescription>Ask Otto the web mechanic to inspect or update code, publish changes, or manage a deployment.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6">
                {detail.messages.map((item) => {
                  const run = detail.runs.find((candidate) => candidate.userMessageId === item.id);
                  return (
                    <Fragment key={item.id}>
                      <div className="grid gap-1.5 text-sm leading-relaxed sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4">
                        <div className={item.role === "user" ? "font-medium text-foreground" : "font-medium text-primary"}>
                          {item.role === "user" ? "You" : "Otto"}
                        </div>
                        <div className="min-w-0">
                          {item.content ? <div className="whitespace-pre-wrap break-words text-foreground/90">{item.content}</div> : null}
                          {item.attachments.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.attachments.map((attachment) => {
                                const url = `${base}/conversations/${conversationId}/attachments/${encodeURIComponent(attachment.id)}`;
                                return (
                                  <div key={attachment.id} className="flex max-w-60 items-center gap-2 rounded-md border bg-muted/20 p-1.5 pr-2 text-xs">
                                    {attachment.kind === "image" ? (
                                      <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
                                        <Image unoptimized src={url} alt={attachment.name} width={36} height={36} className="size-9 rounded object-cover" />
                                      </a>
                                    ) : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                                    <a href={url} download={attachment.name} className="min-w-0 flex-1 hover:underline">
                                      <span className="block truncate font-medium">{attachment.name}</span>
                                      <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
                                    </a>
                                    {item.role === "user" ? (
                                      <button
                                        type="button"
                                        aria-label={`Attach ${attachment.name} again`}
                                        title="Attach again"
                                        disabled={scopeBusy || sending}
                                        onClick={() => reuseAttachment(attachment)}
                                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                      >
                                        <Paperclip className="size-3.5" />
                                      </button>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                          {run && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="capitalize">{shortModel(run.model)}</span>
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
                        <p className="text-sm">{String(approval.details.reason || "Otto requested a production deployment.")}</p>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => decideApproval(approval, "approved")}>Approve deploy</Button>
                          <Button size="sm" variant="outline" onClick={() => decideApproval(approval, "rejected")}>Reject</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

              </div>
            )}
          </div>

          <div className="border-t bg-background p-3 sm:p-4">
            <div className="mx-auto max-w-3xl space-y-2">
              <InputGroup
                className={draggingFiles ? "items-end rounded-xl border-primary bg-primary/5 shadow-sm" : "items-end rounded-xl bg-background shadow-sm"}
                onDragOver={(event) => {
                  if (scopeBusy || sending || !event.dataTransfer.types.includes("Files")) return;
                  event.preventDefault();
                  setDraggingFiles(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDraggingFiles(false);
                  addFiles(Array.from(event.dataTransfer.files));
                }}
              >
                {(pendingFiles.length > 0 || reusedAttachments.length > 0) ? (
                  <InputGroupAddon align="block-start" className="flex-wrap gap-2 pb-0">
                    {pendingFiles.map((file, index) => (
                      <PendingFileChip
                        key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                        file={file}
                        onRemove={() => setPendingFiles((current) => current.filter((_, candidate) => candidate !== index))}
                      />
                    ))}
                    {reusedAttachments.map((attachment) => (
                      <div key={attachment.id} className="flex max-w-52 items-center gap-2 rounded-md border bg-muted/30 p-1.5 pr-2 text-xs">
                        {attachment.kind === "image" ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                          : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{attachment.name}</span>
                          <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setReusedAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                          aria-label={`Remove ${attachment.name}`}
                          className="rounded p-0.5 hover:bg-muted"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </InputGroupAddon>
                ) : null}
                <InputGroupTextarea
                  aria-label="Message Otto"
                  placeholder="Ask Otto to update your site..."
                  rows={2}
                  value={message}
                  disabled={scopeBusy || sending}
                  onChange={(event) => setMessage(event.target.value)}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData.files);
                    if (files.length === 0) return;
                    event.preventDefault();
                    addFiles(files);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  className="min-h-20 max-h-40"
                />
                <InputGroupAddon align="block-end" className="justify-between pt-0">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      hidden
                      multiple
                      accept={AI_ATTACHMENT_ACCEPT}
                      onChange={(event) => {
                        addFiles(Array.from(event.target.files || []));
                        event.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Attach files"
                      title="Attach files"
                      disabled={scopeBusy || sending}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip />
                    </Button>
                    {(pendingFiles.length > 0 || reusedAttachments.length > 0) ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {formatFileSize(selectedBytes)} / 4 MB
                      </span>
                    ) : null}
                  </div>
                  <Button
                    size="icon-sm"
                    aria-label={activeRun ? "Stop Otto" : "Send message"}
                    variant={activeRun ? "destructive" : "default"}
                    disabled={!activeRun && (!message.trim() && pendingFiles.length === 0 && reusedAttachments.length === 0 || sending)}
                    onClick={() => activeRun ? cancelRun() : sendMessage()}
                  >
                    {activeRun ? <Square className="fill-current" /> : sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                  </Button>
                </InputGroupAddon>
              </InputGroup>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Commits go to {config.branch}; successful commits automatically get a preview.</span>
                {!activeRun && lastUserMessage && detail?.runs.at(-1)?.status === "failed" && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => sendMessage(lastUserMessage.content, lastUserMessage.attachments)}
                  >Retry</Button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
