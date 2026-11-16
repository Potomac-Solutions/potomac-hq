// What each refusal code says to a person.
const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That record doesn’t exist.",
  "task-not-in-project": "Choose a project or one of its tasks from the list.",
  "invalid-date": "Enter a date.",
  "date-in-future": "That day hasn’t happened yet.",
  "invalid-hours": "Enter hours like 1.5.",
  "hours-missing": "Enter how many hours.",
  "too-long-for-a-day": "One entry can’t be longer than a day. Split it across days.",
  "note-too-long": "That note is too long.",
  "not-running": "No timer is running.",
  "invalid-category": "Choose a category from the list.",
  "not-an-amount": "Enter an amount like 1,250.00.",
  "amount-must-be-positive": "Enter an amount above zero.",
  "rate-must-be-positive": "Enter an hourly rate above zero.",
  "invalid-payment-status": "Choose a payment status from the list.",
  "invoice-ref-too-long": "That invoice reference is too long.",
  "file-missing": "Choose a file to upload.",
  "file-too-large": "That file is larger than 25 MB.",
  "file-name-invalid": "That file’s name can’t be used. Rename it and try again.",
  "file-type-not-allowed": "That kind of file can’t be uploaded. Use a PDF or an image.",
  "file-content-mismatch": "That file isn’t what its name says it is.",
};

export function messageFor(code: string): string {
  return MESSAGES[code] ?? "That didn’t work. Try again.";
}
