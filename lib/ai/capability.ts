import { createHmac, timingSafeEqual } from "node:crypto";

export type AiCapability = {
  runId: string;
  workspacePath: string;
  expiresAt: number;
};

function getSecret() {
  const secret = process.env.AI_MCP_SECRET || process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("AI_MCP_SECRET or BETTER_AUTH_SECRET is required.");
  return secret;
}

function sign(payload: string) {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createAiCapability(value: AiCapability) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAiCapability(token: string): AiCapability {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Invalid AI capability.");
  const expected = sign(payload);
  if (
    signature.length !== expected.length
    || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) throw new Error("Invalid AI capability signature.");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AiCapability;
  if (!value.runId || !value.workspacePath || value.expiresAt < Date.now()) {
    throw new Error("AI capability expired or is incomplete.");
  }
  return value;
}
