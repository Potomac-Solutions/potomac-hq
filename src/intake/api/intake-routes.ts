// The new-client intake form (2026-11-26).
import { Hono } from "hono";
import { ACCESS_KINDS, FIELD_LABELS, submitIntake, type IntakeDeps } from "../application/intake.ts";
import { formPosts, type Id } from "../../shared/index.ts";

type Session = { readonly organizationId: Id; readonly clientUserId: Id; readonly name: string };
const FILES = ["logo", "photo1", "photo2", "photo3"] as const;

function messageFor(code: string): string {
  if (code.startsWith("too-long:")) return `“${FIELD_LABELS[code.slice(9) as keyof typeof FIELD_LABELS] ?? "One answer"}” is too long. Shorten it a little.`;
  return (
    {
      "not-found": "That isn’t here.",
      "business-name-missing": "Put your business’s name first.",
      "looks-like-a-password": "That looks like a password. Please don’t send passwords here: say which accounts we’ll need, and we’ll ask you to add us as a user.",
      "invalid-email": "That email address doesn’t look right.",
    }[code] ?? "That didn’t work. Nothing was changed."
  );
}

export function intakeRoutes(deps: { readonly intake: IntakeDeps; readonly clientOf: (cookieHeader: string) => Session | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts<Session | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  post(
    "/portal/intake",
    async (session, form, _id, files) => {
      if (!session) return { ok: false as const, error: "not-found" };
      const uploads = FILES.map((name) => files[name]).filter((file) => file !== undefined);
      return submitIntake(deps.intake, session, { ...form, access: ACCESS_KINDS.filter((kind) => form[`access-${kind}`] === "on") }, uploads);
    },
    {
      done: () => "/portal#intake",
      back: () => "/portal/intake",
      message: (result) =>
        [
          result.first ? "Thank you. Potomac Solutions has what it needs to start." : "Saved. Potomac Solutions sees your changes.",
          result.filesSaved > 0 ? `${result.filesSaved === 1 ? "Your file is" : `Your ${result.filesSaved} files are`} with your project.` : "",
          result.filesRefused > 0 ? `${result.filesRefused === 1 ? "One file" : `${result.filesRefused} files`} couldn’t be taken: send ${result.filesRefused === 1 ? "it" : "them"} from your project page.` : "",
        ]
          .filter(Boolean)
          .join(" "),
    },
  );
  return app;
}
