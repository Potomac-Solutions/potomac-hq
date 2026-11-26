// The portal's timeline (quality of life, 2026-11-25): a client's project in
// three short lists, said plainly. What's done, what Potomac is doing next,
// and what is waiting on the client, each linking to where it's dealt with,
// in the words the portal's first page uses for the same things.
// The whole step list stays below it; this is the part to read first.

export type TimelineStep = { readonly id: string; readonly name: string; readonly when: string; readonly done: boolean; readonly yours: boolean };
export type TimelineThing = { readonly id: string; readonly title: string; /** A change's own name, as the client knows it: "Change 2". */ readonly label?: string };
export type TimelineLine = { readonly key: string; readonly text: string; readonly when: string; readonly href: string };
export type Timeline = { readonly done: readonly TimelineLine[]; readonly next: readonly TimelineLine[]; readonly yours: readonly TimelineLine[]; readonly more: number };

/** At most this many in "Done", newest last; the rest are counted. */
export const DONE_SHOWN = 3;
/** At most this many in "Next". */
export const NEXT_SHOWN = 2;

export function portalTimeline(input: {
  readonly steps: readonly TimelineStep[];
  /** Deliverables shared and waiting for the client's decision. */
  readonly toLookAt: readonly TimelineThing[];
  /** Changes to the work sent for the client's answer. */
  readonly toAnswer: readonly TimelineThing[];
}): Timeline {
  const finished = input.steps.filter((step) => step.done);
  const open = input.steps.filter((step) => !step.done);
  const line = (step: TimelineStep): TimelineLine => ({ key: `step-${step.id}`, text: step.name, when: step.when, href: "#pp-progress" });
  return {
    done: finished.slice(-DONE_SHOWN).map(line),
    more: Math.max(0, finished.length - DONE_SHOWN),
    next: open.filter((step) => !step.yours).slice(0, NEXT_SHOWN).map(line),
    yours: [
      ...input.toLookAt.map((one) => ({ key: `look-${one.id}`, text: `Look at “${one.title}”: approve it, or say what should change`, when: "", href: "#deliverables" })),
      ...input.toAnswer.map((one) => ({ key: `change-${one.id}`, text: one.label ? `Answer ${one.label.charAt(0).toLowerCase()}${one.label.slice(1)}: “${one.title}”` : `Answer the change “${one.title}”`, when: "", href: "#changes" })),
      // The client's own steps are mostly things to send, so they go to "Send us a file", as the portal's first page does.
      ...open.filter((step) => step.yours).map((step) => ({ ...line(step), text: step.name, href: "#files" })),
    ],
  };
}
