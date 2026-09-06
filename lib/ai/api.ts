import { getRepoReadContext } from "@/lib/api-repo-context";
import type { AiScope } from "@/lib/ai/store";

export async function getAiApiContext(params: { owner: string; repo: string; branch: string }) {
  const context = await getRepoReadContext(params);
  const scope: AiScope = {
    userId: context.user.id,
    owner: params.owner,
    repo: params.repo,
    branch: params.branch,
  };
  return { ...context, scope };
}
