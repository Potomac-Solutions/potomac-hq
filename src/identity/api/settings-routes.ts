// A person's own settings.
import { Hono } from "hono";
import { changeTheme, changeMorningEmail, type PreferenceDeps } from "../application/preferences.ts";
import { formPosts, type Id } from "../../shared/index.ts";

export type SettingsRoutesDeps = {
  readonly preferences: PreferenceDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

const MESSAGES: Readonly<Record<string, string>> = { forbidden: "Sign in again.", "invalid-theme": "Choose a theme from the list." };

export function settingsRoutes(deps: SettingsRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work. Try again.", home: "/settings" });
  post("/settings/theme", (actor, form) => changeTheme(deps.preferences, actor, form["theme"] ?? ""), { done: () => "/settings", back: () => "/settings", message: "Theme saved." });
  post("/settings/morning-email", (actor, form) => changeMorningEmail(deps.preferences, actor, form["morningEmail"] === "1"), { done: (value) => `/settings#morning-email`, back: () => "/settings#morning-email", message: "Saved." });
  return app;
}
