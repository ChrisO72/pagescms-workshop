import YAML from "yaml";
import { createHttpError } from "@/lib/api-error";
import { createOctokitInstance } from "@/lib/utils/octokit";

type RepositoryScope = { owner: string; repo: string; branch: string };

export async function fetchAiRepositoryConfig(
  octokit: ReturnType<typeof createOctokitInstance>,
  scope: RepositoryScope,
) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: scope.owner,
      repo: scope.repo,
      path: ".pages.yml",
      ref: scope.branch,
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (Array.isArray(response.data) || response.data.type !== "file") {
      throw createHttpError("Expected .pages.yml to be a file.", 400);
    }
    return YAML.parse(
      Buffer.from(response.data.content, "base64").toString("utf8"),
    );
  } catch (error: any) {
    if (error?.status === 404) {
      throw createHttpError(
        "The repository does not contain a .pages.yml configuration.",
        400,
      );
    }
    throw error;
  }
}
