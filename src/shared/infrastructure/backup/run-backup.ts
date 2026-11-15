// Takes a consistent copy of the database, seals it, stores it, and records
// what happened as an activity event. HQ takes this action by itself, so the
// event has no actor.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordActivity, type ActivityDeps } from "../../application/record-activity.ts";
import type { Transact } from "../../application/ports.ts";
import type { Database } from "../database.ts";
import { seal } from "./envelope.ts";
import type { BackupTarget } from "./targets.ts";

export type BackupDeps = ActivityDeps & {
  readonly db: Database;
  readonly transact: Transact;
  readonly target: BackupTarget;
  readonly publicKeyPem: string;
};

export type BackupResult = { readonly name: string; readonly bytes: number };

/** hq-20261115T081700Z.hqbackup */
export function backupName(instant: string): string {
  return `hq-${instant.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "").toLowerCase()}.hqbackup`;
}

export async function runBackup(deps: BackupDeps): Promise<BackupResult> {
  const startedAt = deps.clock();
  const dir = mkdtempSync(join(tmpdir(), "hq-backup-"));
  const copy = join(dir, "hq.db");
  try {
    // VACUUM INTO writes a consistent, compacted copy while HQ keeps running.
    deps.db.prepare("vacuum into ?").run(copy);
    const sealed = seal(readFileSync(copy), deps.publicKeyPem, startedAt);
    const name = backupName(startedAt);
    await deps.target.put(name, sealed);
    deps.transact(() => {
      recordActivity(deps, {
        actorId: null,
        action: "backup.completed",
        recordType: "backup",
        recordId: deps.newId(),
        context: { file: name, bytes: sealed.length },
      });
    });
    return { name, bytes: sealed.length };
  } catch (error) {
    deps.transact(() => {
      recordActivity(deps, {
        actorId: null,
        action: "backup.failed",
        recordType: "backup",
        recordId: deps.newId(),
        context: { reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
      });
    });
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The next daily run at hh:mm in a time zone, after `now`. */
export function nextRun(now: string, zone: string, at: { hour: number; minute: number }): string {
  const local = Temporal.Instant.from(now).toZonedDateTimeISO(zone);
  let next = local.with({ hour: at.hour, minute: at.minute, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
  if (Temporal.ZonedDateTime.compare(next, local) <= 0) next = next.add({ days: 1 });
  return next.toInstant().toString({ fractionalSecondDigits: 3 });
}

/**
 * Runs `task` every day at hh:mm in the zone. Returns a function that stops
 * it. A failed run is logged and the schedule carries on.
 */
export function scheduleDaily(
  task: () => Promise<unknown>,
  options: { zone: string; hour: number; minute: number; clock: () => string; log: (message: string, error?: unknown) => void },
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const plan = () => {
    if (stopped) return;
    const at = nextRun(options.clock(), options.zone, options);
    const wait = Math.max(1000, Temporal.Instant.from(at).epochMilliseconds - Temporal.Instant.from(options.clock()).epochMilliseconds);
    timer = setTimeout(() => {
      task()
        .catch((error: unknown) => options.log("Scheduled backup failed", error))
        .finally(plan);
    }, wait);
    timer.unref();
  };
  plan();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
