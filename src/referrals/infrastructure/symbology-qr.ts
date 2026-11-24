// QR codes for referral links, drawn by symbology
// (github.com/journey-to-code-org/symbology): its Rust encoder, built to
// WebAssembly and shipped inside the package, so nothing is fetched. Byte
// mode, error correction level M, up to 213 bytes: plenty for a short
// address.
import { loadQr, QrError } from "@journey-to-code/symbology";
import type { QrMaker } from "../application/ports.ts";

// Loaded once, when HQ starts. The package reads its own .wasm file from disk.
const qr = await loadQr();

/** One path on a white square with a quiet zone of four modules, sharp at any size. */
export const symbologyQr: QrMaker = (text, title) => {
  try {
    return qr.svg(qr.encode(text), { title });
  } catch (error) {
    // Too long, or empty: there is no code to draw. Anything else is a fault.
    if (error instanceof QrError && (error.code === "too-long" || error.code === "empty")) return null;
    throw error;
  }
};
