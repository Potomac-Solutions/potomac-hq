// A label: a short name and a colour, put on tasks to find and group them
// (decision 0007, section 2). Labels are shared by everyone. A name is
// unique, whatever its capitals.
import { requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** Twelve colours, each a light and dark pair in theme.css that passes contrast with its text. */
export const LABEL_COLOURS = ["slate", "red", "orange", "amber", "green", "teal", "sky", "blue", "indigo", "violet", "pink", "brown"] as const;
export type LabelColour = (typeof LABEL_COLOURS)[number];

export const LABEL_COLOUR_NAMES: Readonly<Record<LabelColour, string>> = {
  slate: "Slate",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  sky: "Sky",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  pink: "Pink",
  brown: "Brown",
};

export type Label = {
  readonly id: Id;
  readonly name: string;
  readonly colour: LabelColour;
};

export type LabelInput = {
  readonly name: string;
  /** Empty or missing picks one from the name. */
  readonly colour?: string | null;
};

export type LabelError = "name-missing" | "name-too-long" | "invalid-colour";

export const LABEL_NAME_MAX = 40;

export const isLabelColour = (value: string): value is LabelColour => (LABEL_COLOURS as readonly string[]).includes(value);

/** Inner runs of spaces become one, so "client  work" and "client work" are the same label. */
const tidy = (name: string): string => name.trim().replace(/\s+/g, " ");

/** The key two names are compared by: "Website" and "website " are one label. */
export const labelKey = (name: string): string => tidy(name).toLocaleLowerCase("en");

/** A colour for a label made without one: the same name always gets the same colour. */
export function colourFor(name: string): LabelColour {
  let hash = 0;
  for (const char of labelKey(name)) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return LABEL_COLOURS[hash % LABEL_COLOURS.length] as LabelColour;
}

function fields(input: LabelInput): Result<Omit<Label, "id">, LabelError> {
  const name = requiredText(tidy(input.name ?? ""), LABEL_NAME_MAX);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const chosen = (input.colour ?? "").trim();
  if (chosen !== "" && !isLabelColour(chosen)) return err("invalid-colour");
  return ok({ name: name.value, colour: chosen === "" ? colourFor(name.value) : (chosen as LabelColour) });
}

export function newLabel(id: Id, input: LabelInput): Result<Label, LabelError> {
  const checked = fields(input);
  return checked.ok ? ok({ id, ...checked.value }) : checked;
}

/** A rename or a new colour. Leaving the colour empty keeps the one it has. */
export function editLabel(label: Label, input: LabelInput): Result<Label, LabelError> {
  const checked = fields({ name: input.name, colour: (input.colour ?? "").trim() || label.colour });
  return checked.ok ? ok({ ...label, ...checked.value }) : checked;
}

/** What changes when a task's labels go from `before` to `after`. Each id once, in the order given. */
export function labelChanges(before: readonly Id[], after: readonly Id[]): { readonly added: Id[]; readonly removed: Id[] } {
  const now = [...new Set(after)];
  return { added: now.filter((id) => !before.includes(id)), removed: before.filter((id) => !now.includes(id)) };
}

/** Alphabetical, the way people look for a name. */
export const byLabelName = (a: Pick<Label, "name">, b: Pick<Label, "name">): number => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
