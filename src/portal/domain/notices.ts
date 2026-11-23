// What gets said in a notice. A notice is an email that says something
// happened in the portal. It never carries the thing itself: no amount, no
// message text, no file. Email is not private, and the portal is.

/** Things a client did that Potomac wants to hear about. */
export const CLIENT_ACTIONS = ["project.message-received", "file.received-from-client", "deliverable.approved", "deliverable.changes-requested", "proposal.accepted-in-portal", "proposal.declined-in-portal", "call.requested", "change-request.approved", "change-request.declined", "schedule-invite.answered"] as const;

/** Things Potomac did that leave something for the client to see or do. */
export const FOR_CLIENT_ACTIONS: Readonly<Record<string, string>> = {
  "deliverable.shared": "Something for you to look at and approve",
  "proposal.shared": "A proposal to read and answer",
  "invoice.sent": "An invoice",
  "change-request.sent": "A change to your project to approve or decline",
  "project.update-posted": "An update on your project",
  "call.confirmed": "An answer about the call you asked for",
  "call.declined": "An answer about the call you asked for",
  "milestone.given-to-client": "Something the work needs from you",
};

export type StaffLine = { readonly who: string; readonly organization: string; readonly did: string; readonly path: string };

/** "Dale Hinkle (Hinkle Family Farm) sent a file on Farm stand website." */
export const staffSentence = (line: StaffLine): string => `${line.who}${line.organization ? ` (${line.organization})` : ""} ${line.did}.`;

export function staffEmail(name: string, lines: readonly StaffLine[], publicUrl: string): { subject: string; body: string } {
  const first = lines[0];
  const subject = lines.length === 1 && first ? `${first.who} ${first.did}` : `${lines.length} things from clients in Potomac HQ`;
  const body = [`Hi ${name},`, "", lines.length === 1 ? "A client did something in the portal:" : "Clients did these in the portal:", "", ...lines.flatMap((line) => [`- ${staffSentence(line)}`, `  ${publicUrl}${line.path}`]), "", "Potomac HQ"].join("\n");
  return { subject: subject.slice(0, 150), body };
}

export function clientEmail(input: { readonly name: string; readonly organization: string; readonly kinds: readonly string[]; readonly publicUrl: string; readonly phone: string }): { subject: string; body: string } {
  const kinds = [...new Set(input.kinds)];
  return {
    subject: "Something new from Potomac Solutions",
    body: [
      `Hi ${input.name},`,
      "",
      `There is something new for ${input.organization} in your client portal:`,
      "",
      ...kinds.map((kind) => `- ${kind}`),
      "",
      "Sign in to see it:",
      `${input.publicUrl}/portal`,
      "",
      ...(input.phone ? [`Rather talk? Call ${input.phone}.`, ""] : []),
      "To stop these emails, sign in and turn them off at the bottom of the page.",
      "",
      "Potomac Solutions",
    ].join("\n"),
  };
}
