// What each refusal code says to a person.
const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That record doesn’t exist.",
  "invalid-kind": "Choose what it is from the list.",
  "label-too-long": "Keep the name under 80 characters.",
  "invalid-url": "Enter a web address, like staging.example.com.",
  "name-missing": "Enter a name.",
  "name-too-long": "That name is too long.",
  "description-too-long": "That description is too long.",
  "invalid-health": "Choose how it is going from the list.",
  "invalid-date": "Enter a date.",
  "target-before-start": "The target date is before the start date.",
  "invalid-status": "Choose a status from the list.",
  unchanged: "Nothing changed.",
  final: "This project is closed. A closed project stays closed.",
  "ongoing-never-completes": "An ongoing plan is never completed. Cancel it when it ends.",
  "person-not-found": "Choose a person from the list.",
  "project-closed": "This project is closed, so nothing can be added to it.",
  "phase-not-in-project": "Choose a phase of this project.",
  "already-done": "That milestone is already done.",
  "not-done": "That milestone is not done.",
  "title-missing": "Enter a title.",
  "title-too-long": "That title is too long.",
  "invalid-priority": "Choose a priority from the list.",
  "invalid-estimate": "Enter the estimate in hours, like 1.5.",
  "file-missing": "Choose a file to upload.",
  "file-too-large": "That file is larger than 25 MB.",
  "file-name-invalid": "That file’s name can’t be used. Rename it and try again.",
  "file-type-not-allowed": "That kind of file can’t be uploaded. Use a PDF, an image, a text, CSV or Office file, or a zip.",
  "file-content-mismatch": "That file isn’t what its name says it is.",
  "already-shared": "That deliverable is already shared.",
  "not-shared": "That deliverable isn’t shared.",
  "already-approved": "The client approved that deliverable, so it stays shared.",
};

export function messageFor(code: string): string {
  return MESSAGES[code] ?? "That didn’t work. Try again.";
}
