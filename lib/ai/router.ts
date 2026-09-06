import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { AiRoute } from "@/types/ai";

const routeSchema = z.object({
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]),
  effort: z.enum(["low", "medium", "high"]),
  category: z.enum(["chat", "repository", "deployment", "complex"]),
  rationale: z.string().max(160),
});

const fallbackRoute: AiRoute = {
  model: "gpt-5.6-terra",
  effort: "medium",
  category: "repository",
  rationale: "Used the safe default because routing was unavailable.",
};

export async function routeAiMessage(message: string): Promise<AiRoute> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to use the AI assistant.");
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.parse({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: [
                "Route a Pages CMS coding-agent request.",
                "Choose gpt-5.6-luna for conversation, status checks, deployments, or a small isolated edit.",
                "Choose gpt-5.6-terra for normal coding work and multi-file changes.",
                "Choose gpt-5.6-sol only for broad refactors, difficult debugging, or high-complexity architecture work.",
                "Use low effort with Luna, medium with Terra, and high with Sol unless the request clearly needs less.",
                "The rationale is displayed to the user; keep it concrete and under one sentence.",
              ].join(" "),
            },
          ],
        },
        { role: "user", content: [{ type: "input_text", text: message }] },
      ],
      text: { format: zodTextFormat(routeSchema, "pagescms_ai_route") },
    });
    return response.output_parsed ?? fallbackRoute;
  } catch (error) {
    console.error("AI router failed; using Terra fallback.", error);
    return fallbackRoute;
  }
}
