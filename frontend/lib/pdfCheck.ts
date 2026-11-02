// Browser checks before upload. A rejected file is never sent.
import { MAX_UPLOAD_MB } from "./config";

export type PdfCheck = { ok: true } | { ok: false; message: string };

export async function checkPdf(file: File): Promise<PdfCheck> {
  const reject = (message: string): PdfCheck => ({
    ok: false,
    message: `${file.name} was not uploaded. ${message}`,
  });

  const hasPdfName = file.name.toLowerCase().endsWith(".pdf");
  const hasPdfType = file.type === "application/pdf" || file.type === "";
  if (!hasPdfName || !hasPdfType) {
    return reject("PaperCast accepts PDF files only.");
  }
  if (file.size === 0) return reject("The file is empty.");
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return reject(`The limit is ${MAX_UPLOAD_MB} MB.`);
  }

  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== "%PDF-") {
    return reject("The file does not start with %PDF-, so it is not a real PDF.");
  }
  return { ok: true };
}
