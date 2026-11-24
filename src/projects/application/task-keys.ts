// Task keys (decision 0008, section 1): changing a project's key, and finding
// a task by "BDW-12". A key a project once had still finds its tasks.
import { readKey, readRef, TODO_KEY, type KeyError } from "../domain/task-key.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused } from "./commands.ts";

/** Changes a project's key. Needs `project.edit`. */
export function setProjectKey(deps: ProjectsDeps, actorId: Id | null, projectId: Id, text: string): Result<{ readonly key: string; readonly projectId: Id }, Refused | KeyError | "unchanged"> {
  if (actorId === null || !authorize(deps, actorId, "project.edit").ok) return err("forbidden");
  const read = readKey(text);
  if (!read.ok) return read;
  return deps.transact(() => {
    const was = deps.projects.keyOf(projectId);
    if (was === null) return err("not-found");
    if (was === read.value) return err("unchanged");
    if (deps.projects.keyTaken(read.value, projectId)) return err("key-taken");
    deps.projects.setKey(projectId, read.value, deps.clock());
    recordActivity(deps, { actorId, action: "project.key-changed", recordType: "project", recordId: projectId, context: { projectId, from: was, to: read.value } });
    return ok({ key: read.value, projectId });
  });
}

/** The task "BDW-12" (or "bdw-12", or an old key's) is, if you may see tasks; null otherwise. */
export function findTaskByRef(deps: ProjectsDeps, actorId: Id | null, text: string): Id | null {
  if (actorId === null || !authorize(deps, actorId, "task.view").ok) return null;
  const ref = readRef(text);
  if (!ref) return null;
  if (ref.key === TODO_KEY) return deps.tasks.byNumber(null, ref.number);
  const projectId = deps.projects.byKey(ref.key);
  return projectId ? deps.tasks.byNumber(projectId, ref.number) : null;
}
