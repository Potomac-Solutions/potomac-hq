// Public entry for the shared module. Other modules' application, api and
// infrastructure code imports from here. Domain code imports
// src/shared/domain directly (the one allowed exception).
export { activityEvent, type ActivityDraft, type ActivityError, type ActivityEvent, type Context, type ContextValue } from "./domain/activity.ts";
export { parseId, type Id } from "./domain/id.ts";
export { addMoney, formatMoney, isCurrency, money, parseAmount, sameMoney, CURRENCIES, type Currency, type Money, type MoneyError } from "./domain/money.ts";
export { err, ok, type Err, type Ok, type Result } from "./domain/result.ts";
export type { ActivityLog, Clock, IdSource, Transact } from "./application/ports.ts";
export { InvalidActivityError, recordActivity, type ActivityDeps } from "./application/record-activity.ts";
export { calendarDate, optionalEmail, optionalText, requiredText } from "./domain/fields.ts";
export { describeAction, describeEvent } from "./domain/wording.ts";
export { formPosts, readForm, readUndo, stashUndo, withMessage, withUndo, type FormAnswer, type FormFields, type FormFiles, type FormPostDeps, type Places, type Undo, type UploadedFile } from "./api/forms.ts";
export { csvField, toCsv, type Cell } from "./domain/csv.ts";
export { daysUntil, dueText, friendlyDay, howSoon } from "./domain/days.ts";
export { crc32, zipFiles } from "./domain/zip.ts";
export { formatHours, parseHours, readableHours } from "./domain/hours.ts";
export { qrCode, qrSvg, type QrCode } from "./domain/qr.ts";
export { allDayCalendar, type AllDayEvent } from "./domain/calendar-file.ts";
