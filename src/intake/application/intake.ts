// The new-client intake (2026-11-26). A signed-in client fills it in once in
// the portal (and can change it); their logo and photos go to their newest
// open project's files. Anyone who may see the client reads it on the
// client's page in HQ.
export { ACCESS_KINDS, FIELD_LABELS } from "../domain/intake.ts";
import { ACCESS_LABELS, FIELD_LABELS, readIntake, type IntakeAnswers, type IntakeError } from "../domain/intake.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { friendlyDay, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type IntakeRecord = { readonly organizationId: Id; readonly answers: IntakeAnswers; readonly sentBy: Id; readonly sentAt: string; readonly updatedAt: string };

export type IntakeStore = {
  get(organizationId: Id): IntakeRecord | null;
  save(record: IntakeRecord): void;
};

export type IntakeDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly intakes: IntakeStore;
  readonly today: () => string;
  /** The client's newest open project, where their files go, or null. */
  readonly newestProject: (organizationId: Id) => { readonly id: Id; readonly name: string } | null;
  /** Saves one upload to a project's files as the client's. Opens its own transaction. */
  readonly saveUpload: (session: Session, projectId: Id, upload: { readonly name: string; readonly bytes: Uint8Array }) => Result<unknown, string>;
  readonly clientUserName: (clientUserId: Id) => string;
};

type Session = { readonly organizationId: Id; readonly clientUserId: Id; readonly name: string };
type Upload = { readonly name: string; readonly bytes: Uint8Array };

export type SubmitResult = { readonly first: boolean; readonly filesSaved: number; readonly filesRefused: number };

export async function submitIntake(deps: IntakeDeps, session: Session, input: Readonly<Record<string, string | readonly string[] | undefined>>, uploads: readonly Upload[]): Promise<Result<SubmitResult, IntakeError | `too-long:${string}`>> {
  const read = readIntake(input);
  if (!read.ok) return read;
  const first = deps.transact(() => {
    const before = deps.intakes.get(session.organizationId);
    const at = deps.clock();
    deps.intakes.save({ organizationId: session.organizationId, answers: read.value, sentBy: session.clientUserId, sentAt: before?.sentAt ?? at, updatedAt: at });
    recordActivity(deps, { actorId: null, action: before ? "intake.changed" : "intake.received", recordType: "client", recordId: session.organizationId, context: { clientUserId: session.clientUserId } });
    return before === null;
  });
  let filesSaved = 0;
  let filesRefused = 0;
  const project = deps.newestProject(session.organizationId);
  for (const upload of uploads) {
    if (!project) {
      filesRefused += 1;
      continue;
    }
    if (deps.saveUpload(session, project.id, upload).ok) filesSaved += 1;
    else filesRefused += 1;
  }
  return ok({ first, filesSaved, filesRefused });
}

export type IntakeForm = { readonly answers: IntakeAnswers | null; readonly sent: string; readonly filesGoTo: string; readonly access: readonly { readonly value: string; readonly label: string; readonly checked: boolean }[] };

export function portalIntake(deps: IntakeDeps, session: Session): IntakeForm {
  const record = deps.intakes.get(session.organizationId);
  return {
    answers: record?.answers ?? null,
    sent: record ? friendlyDay(record.updatedAt.slice(0, 10), deps.today()) : "",
    filesGoTo: deps.newestProject(session.organizationId)?.name ?? "",
    access: Object.entries(ACCESS_LABELS).map(([value, label]) => ({ value, label, checked: record?.answers.access.includes(value as never) ?? false })),
  };
}

export type IntakeSummary = { readonly sent: string; readonly by: string; readonly rows: readonly { readonly label: string; readonly value: string }[]; readonly access: readonly string[]; readonly accessNote: string };

/** The client's answers for their page in HQ, or null when they haven't sent it or the viewer can't see clients. */
export function clientIntake(deps: IntakeDeps, actorId: Id | null, organizationId: Id): IntakeSummary | null {
  if (actorId === null || !authorize(deps, actorId, "client.view").ok) return null;
  const record = deps.intakes.get(organizationId);
  if (!record) return null;
  const a = record.answers;
  const rows = (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).filter((key) => key !== "accessNote" && a[key]).map((key) => ({ label: FIELD_LABELS[key], value: a[key] }));
  return { sent: friendlyDay(record.updatedAt.slice(0, 10), deps.today()), by: deps.clientUserName(record.sentBy), rows, access: a.access.map((kind) => ACCESS_LABELS[kind]), accessNote: a.accessNote };
}

