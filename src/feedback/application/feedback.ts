// "How did we do?" (2026-11-26). When a client's project is finished, the
// portal asks once. A low score is private: it makes a to-do for whoever ran
// the project to call them. A high one leads on to the review they may write.
import { LOW_SCORE, readFeedback, SCORE_WORDS, type FeedbackError } from "../domain/feedback.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, friendlyDay, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type Feedback = { readonly projectId: Id; readonly clientUserId: Id; readonly score: number; readonly note: string; readonly todoId: Id | null; readonly createdAt: string };

export type FeedbackStore = {
  get(projectId: Id): Feedback | null;
  insert(feedback: Feedback): void;
  /** The client's finished projects with no feedback yet, newest first. */
  waiting(organizationId: Id): { readonly id: Id; readonly name: string; readonly ownerId: Id }[];
  /** The client's most recent score, or null. */
  latestScore(organizationId: Id): number | null;
  projectOf(projectId: Id): { readonly id: Id; readonly name: string; readonly organizationId: Id; readonly ownerId: Id; readonly status: string } | null;
};

export type FeedbackDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly feedback: FeedbackStore;
  readonly today: () => string;
  readonly clientName: (organizationId: Id) => string;
  readonly clientUserName: (clientUserId: Id) => string;
  /** A to-do about the client, for someone. Inside the caller's transaction. */
  readonly makeTodo: (input: { readonly projectId: null; readonly organizationId: Id; readonly title: string; readonly description: string; readonly assigneeId: Id | null }) => Result<{ readonly id: Id }, string>;
  /** Whether the client may still write a review. */
  readonly mayReview: (organizationId: Id) => boolean;
};

type Session = { readonly organizationId: Id; readonly clientUserId: Id; readonly name: string };

/** True when the client's latest rating was low: not the moment to ask for a public review. */
export const lastRatingLow = (deps: FeedbackDeps, session: Session): boolean => (deps.feedback.latestScore(session.organizationId) ?? 5) <= LOW_SCORE;

export const feedbackWaiting = (deps: FeedbackDeps, session: Session) => deps.feedback.waiting(session.organizationId).map((one) => ({ id: one.id, name: one.name }));

export function giveFeedback(deps: FeedbackDeps, session: Session, projectId: Id, input: { readonly score: string; readonly note?: string | null }): Result<{ readonly score: number; readonly review: boolean }, FeedbackError | "not-found" | "already-given"> {
  const read = readFeedback(input);
  if (!read.ok) return read;
  return deps.transact(() => {
    const project = deps.feedback.projectOf(projectId);
    if (!project || project.organizationId !== session.organizationId || project.status !== "completed") return err("not-found");
    if (deps.feedback.get(projectId)) return err("already-given");
    let todoId: Id | null = null;
    if (read.value.score <= LOW_SCORE) {
      const todo = deps.makeTodo({
        projectId: null,
        organizationId: session.organizationId,
        title: `Call ${deps.clientName(session.organizationId)} about how “${project.name}” went`.slice(0, 120),
        description: `${session.name} rated it ${read.value.score} of 5 (${SCORE_WORDS[read.value.score]}).${read.value.note ? `\n\n“${read.value.note}”` : ""}`,
        assigneeId: project.ownerId,
      });
      if (todo.ok) todoId = todo.value.id;
    }
    deps.feedback.insert({ projectId, clientUserId: session.clientUserId, score: read.value.score, note: read.value.note, todoId, createdAt: deps.clock() });
    recordActivity(deps, { actorId: null, action: "project.feedback", recordType: "project", recordId: projectId, context: { score: read.value.score, clientUserId: session.clientUserId, low: read.value.score <= LOW_SCORE } });
    return ok({ score: read.value.score, review: read.value.score > LOW_SCORE && deps.mayReview(session.organizationId) });
  });
}

export type FeedbackView = { readonly score: number; readonly words: string; readonly note: string; readonly by: string; readonly when: string; readonly low: boolean };

/** What the client said about a project, for its page in HQ. Null when nothing yet or the viewer can't see the project. */
export function projectFeedback(deps: FeedbackDeps, actorId: Id | null, projectId: Id): FeedbackView | null {
  if (actorId === null || !authorize(deps, actorId, "project.view").ok) return null;
  const found = deps.feedback.get(projectId);
  if (!found) return null;
  return { score: found.score, words: SCORE_WORDS[found.score] ?? "", note: found.note, by: deps.clientUserName(found.clientUserId), when: friendlyDay(found.createdAt.slice(0, 10), deps.today()), low: found.score <= LOW_SCORE };
}
