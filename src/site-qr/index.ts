// Public entry for client QR codes (decision 0023): addresses on the client's
// own site, printed on cards and flyers, counted by a script on that site.
export * from "./application/site-qr.ts";
export type { QrPictures, SiteQrStore } from "./application/ports.ts";
export { REF_PARAM, type SiteQrCode } from "./domain/code.ts";
