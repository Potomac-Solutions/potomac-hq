// Going live (decision 0010, section 6): what a new repository is called,
// the branch a pull request comes from, and what a commit says.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type PublishInputError = "target-invalid" | "repo-name-invalid";

/** A new repository's name: `<client>-site` unless changed. */
export const suggestedRepoName = (clientName: string): string => `${clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "client"}-site`;

export function checkRepoName(text: string): Result<string, PublishInputError> {
  const name = text.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === "." || name === ".." || name.endsWith(".git")) return err("repo-name-invalid");
  return ok(name);
}

/** The branch a version is sent on to a client's own repository. One per version. */
export const pullBranch = (version: number): string => `hq/site-builder-v${version}`;

export function commitMessage(buildName: string, version: number, summary: string): string {
  return `${buildName}: version ${version}\n\n${summary}\n\nPublished from the Potomac HQ site builder.`;
}

export function pullRequestBody(version: number, summary: string): string {
  return `Version ${version} of this site from the Potomac HQ site builder.\n\n${summary}\n\nThe files are plain HTML, CSS and JavaScript at the top of the repository, beside what was here. Check the preview in HQ, and whatever this repository builds, before merging.`;
}
