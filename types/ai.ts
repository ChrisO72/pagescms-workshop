export const AI_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"] as const;

export type AiModel = (typeof AI_MODELS)[number];
export type AiEffort = "low" | "medium" | "high";
export type AiRunStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export type AiRoute = {
  model: AiModel;
  effort: AiEffort;
  category: "chat" | "repository" | "deployment" | "complex";
  rationale: string;
};

export type AiConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AiRunEvent = {
  id: number;
  runId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type AiApproval = {
  id: string;
  runId: string;
  kind: string;
  status: string;
  requestedSha: string;
  details: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
};
