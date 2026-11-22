// Error logging and the alert email (roadmap v1.0, "monitoring"). Every
// error is written to stderr as one line of JSON, which Railway keeps and
// searches. When an alert address is set, the same error is emailed, at most
// once every fifteen minutes for the same message, so a fault that repeats
// does not fill an inbox.
import type { Send } from "../email/brevo.ts";

export type Monitor = {
  /** Logs an error, and alerts if alerts are set up. Never throws. */
  report(message: string, error?: unknown): void;
  /** Logs something worth knowing that is not a fault. */
  note(message: string): void;
  /** Resolves when every alert being sent has finished. For tests and shutdown. */
  settled(): Promise<void>;
};

export type MonitorOptions = {
  /** Where alerts go, and how. Null when alerts are not set up. */
  readonly alert: { readonly to: string; readonly send: Send } | null;
  readonly clock: () => string;
  readonly write?: (line: string) => void;
  /** What this HQ is called in an alert's subject: its public address. */
  readonly name: string;
  readonly quietMs?: number;
};

function describe(error: unknown): { name: string; message: string; stack?: string } | undefined {
  if (error === undefined || error === null || error === "") return undefined;
  if (error instanceof Error) return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  return { name: "Thrown", message: typeof error === "string" ? error : JSON.stringify(error) };
}

export function createMonitor(options: MonitorOptions): Monitor {
  const write = options.write ?? ((line: string) => console.error(line));
  const quietMs = options.quietMs ?? 15 * 60_000;
  const lastAlert = new Map<string, { at: number; held: number }>();
  const sending = new Set<Promise<unknown>>();

  const line = (level: "error" | "info", message: string, error?: unknown) => {
    const described = describe(error);
    write(JSON.stringify({ level, at: options.clock(), message, ...(described ? { error: described } : {}) }));
  };

  function alert(message: string, error: unknown): void {
    if (!options.alert) return;
    // An address in a message ("GET /projects/<id>") would make every one new, so ids are folded.
    const key = message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>");
    const now = Temporal.Instant.from(options.clock()).epochMilliseconds;
    const last = lastAlert.get(key);
    if (last && now - last.at < quietMs) {
      last.held += 1;
      return;
    }
    const held = last?.held ?? 0;
    if (lastAlert.size >= 500) lastAlert.clear();
    lastAlert.set(key, { at: now, held: 0 });
    const described = describe(error);
    const body = [
      `Potomac HQ at ${options.name} logged an error at ${options.clock()}.`,
      "",
      message,
      ...(described ? ["", `${described.name}: ${described.message}`, "", described.stack ?? ""] : []),
      ...(held > 0 ? ["", `The same error happened ${held} more time${held === 1 ? "" : "s"} since the last alert.`] : []),
      "",
      "The same error will not be emailed again for fifteen minutes. The full log is in Railway.",
    ].join("\n");
    const { to, send } = options.alert;
    const task = send({ channel: "email", to, subject: `Potomac HQ error: ${key.slice(0, 80)}`, body })
      .then((result) => {
        if (!("ok" in result)) line("error", `The alert email was not sent: ${result.error}`);
      })
      .catch((failure: unknown) => line("error", "The alert email was not sent", failure))
      .finally(() => sending.delete(task));
    sending.add(task);
  }

  return {
    report(message, error) {
      try {
        line("error", message, error);
        alert(message, error);
      } catch {
        // Logging must never be the thing that fails.
      }
    },
    note(message) {
      line("info", message);
    },
    async settled() {
      await Promise.allSettled([...sending]);
    },
  };
}

/** The alert address from the environment, or null. Throws when it is not an address. */
export function alertAddressFrom(env: NodeJS.ProcessEnv): string | null {
  const to = (env["HQ_ALERT_EMAIL"] ?? "").trim();
  if (!to) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("HQ_ALERT_EMAIL must be an email address.");
  return to;
}
