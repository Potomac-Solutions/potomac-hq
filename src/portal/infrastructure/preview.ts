// Viewing a client person's portal (decision 0020). While a request runs
// inside a preview, every place that asks "which client is this?" is answered
// with the previewed person, and the app refuses every change. Whether a
// preview may run at all is decided per request, before it starts, by
// previewSession in the application layer; this only carries the answer.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession } from "../domain/client-user.ts";

const scope = new AsyncLocalStorage<ClientSession>();

/** Runs `fn` with the portal showing as this client person. */
export const runPortalPreview = <T>(session: ClientSession, fn: () => T): T => scope.run(session, fn);

/** The client person this request is previewing, or null. */
export const portalPreviewing = (): ClientSession | null => scope.getStore() ?? null;
