import type { Automation } from "../domain/automation.ts";
import type { Id } from "../../shared/index.ts";

export type AutomationStore = {
  get(id: Id): Automation | null;
  byTokenHash(hash: string): Automation | null;
  /** A client's, by name. */
  listFor(organizationId: Id): Automation[];
  /** Every one, by client then name. */
  list(): Automation[];
  insert(automation: Automation, tokenHash: string, at: string): void;
  save(automation: Automation, at: string): void;
  setToken(id: Id, tokenHash: string, at: string): void;
  remove(id: Id): void;
  /** Keeps a run, and only the newest `keep` of them. */
  addRun(id: Id, run: { readonly at: string; readonly status: "ok" | "failed"; readonly message: string }, keep: number): void;
  /** Newest first. */
  runs(id: Id, limit: number): { readonly at: string; readonly status: "ok" | "failed"; readonly message: string }[];
};

export type SecretTokens = { newToken(): string; hash(token: string): string };
