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

export const AI_ATTACHMENT_MAX_FILES = 4;
export const AI_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const AI_ATTACHMENT_CONVERSATION_MAX_BYTES = 40 * 1024 * 1024;
export const AI_ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  ".txt", ".md", ".csv", ".json", ".jsonl", ".yaml", ".yml", ".xml",
  ".html", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".astro", ".vue", ".svelte", ".toml", ".ini", ".env", ".sql", ".graphql",
  ".gql", ".sh", ".svg",
].join(",");

export type AiAttachment = {
  id: string;
  name: string;
  mediaType: string;
  kind: "image" | "text";
  sizeBytes: number;
};

export type AiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  attachments: AiAttachment[];
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
