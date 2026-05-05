import { DateTime } from "luxon";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import type { Booking } from "@/lib/store";
import { head, put, get } from "@vercel/blob";
import { blobPdfKey } from "@/lib/blob-pd-key";

export interface PaidBookingJson {
  savedAt: string;
  bookingId: string;
  status: "PAID";
  paidAt: number;
  name: string;
  phone: string;
  email: string;
  event: string;
  venue: string;
  reference: string;
  tickets: Booking["tickets"];
  total: number;
  breakdown: string;
}

function buildPaidRecord(booking: Booking): PaidBookingJson {
  const reference = `${booking.name} - ${booking.breakdown}`;
  return {
    savedAt: DateTime.now().toISO(),
    bookingId: booking.bookingId,
    status: "PAID",
    paidAt: booking.paidAt ?? Date.now(),
    name: booking.name,
    phone: booking.phone,
    email: booking.email,
    event: booking.event,
    venue: booking.venue,
    reference,
    tickets: booking.tickets,
    total: booking.total,
    breakdown: booking.breakdown,
  };
}

/** Site-inspired palette (matches globals.css tokens). */
const C = {
  pageBg: rgb(244 / 255, 247 / 255, 1),
  navy: rgb(10 / 255, 22 / 255, 40 / 255),
  gold: rgb(245 / 255, 166 / 255, 35 / 255),
  goldDeep: rgb(212 / 255, 136 / 255, 26 / 255),
  green: rgb(0, 166 / 255, 81 / 255),
  white: rgb(1, 1, 1),
  text: rgb(17 / 255, 17 / 255, 17 / 255),
  muted: rgb(102 / 255, 102 / 255, 102 / 255),
  border: rgb(226 / 255, 228 / 255, 232 / 255),
  cardShadow: rgb(220 / 255, 224 / 255, 232 / 255),
};

/**
 * FIX #3: Sanitize strings to WinAnsi range so pdf-lib's standard fonts
 * (Helvetica, HelveticaBold) don't throw on characters outside Latin-1.
 * Accented chars are decomposed first (NFD) so e.g. "é" → "e" + combining
 * accent → the accent is stripped, keeping the base letter readable.
 */
function sanitize(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/[^\x00-\xFF]/g, "?"); // replace remaining non-Latin-1 with ?
}

function splitToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxW: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
    } else {
      if (cur) {
        lines.push(cur);
      }
      cur = w;
    }
  }
  if (cur) {
    lines.push(cur);
  }
  return lines.length ? lines : [""];
}

/**
 * PDF ticket: branded layout + QR whose payload is **only** `bookingId` (plain text)
 * so scanners return the id for comparison with JSON / server records at the gate.
 *
 * FIX #1: Guard empty bookingId before QR generation.
 * FIX #2: Embed fonts in parallel with Promise.all.
 * FIX #3: Sanitize all user-supplied text to WinAnsi range.
 * FIX #4: Error propagation — errors are logged and re-thrown.
 * FIX #5: Layout floor guard — stop drawing rows when approaching the total bar.
 */
async function renderPdf(record: PaidBookingJson): Promise<Buffer> {
  // FIX #1 — Guard: bookingId must be present before we attempt QR generation
  if (!record.bookingId?.trim()) {
    throw new Error(
      "[renderPdf] bookingId is empty or missing — cannot generate QR code.",
    );
  }

  const W = 595.28;
  const H = 841.89;
  const m = 40;
  const headerH = 118;
  const goldStrip = 4;

  const pdfDoc = await PDFDocument.create();
  const page: PDFPage = pdfDoc.addPage([W, H]);

  // FIX #2 — Embed fonts in parallel to avoid sequential async failures
  const [regular, bold] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
  ]);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.pageBg });

  page.drawRectangle({
    x: 0,
    y: H - headerH,
    width: W,
    height: headerH,
    color: C.navy,
  });
  page.drawRectangle({
    x: 0,
    y: H - headerH - goldStrip,
    width: W,
    height: goldStrip,
    color: C.gold,
  });

  page.drawText("KENYATTA UNIVERSITY MUSIC DEPARTMENT", {
    x: m,
    y: H - 36,
    size: 7,
    font: bold,
    color: C.gold,
  });

  // FIX #3 — Sanitize event title before drawText
  const titleLines = splitToWidth(
    sanitize(record.event).toUpperCase(),
    bold,
    17,
    W - m * 2 - 88,
  );
  let titleY = H - 58;
  for (const line of titleLines) {
    page.drawText(line, {
      x: m,
      y: titleY,
      size: 17,
      font: bold,
      color: C.white,
    });
    titleY -= 20;
  }

  page.drawText("Tixly e-ticket - Symphonic evening", {
    x: m,
    y: H - 102,
    size: 9,
    font: regular,
    color: rgb(0.75, 0.78, 0.85),
  });

  const paidW = bold.widthOfTextAtSize("PAID", 10);
  page.drawRectangle({
    x: W - m - paidW - 22,
    y: H - 52,
    width: paidW + 22,
    height: 22,
    color: C.gold,
    borderColor: C.goldDeep,
    borderWidth: 0.5,
  });
  page.drawText("PAID", {
    x: W - m - paidW - 11,
    y: H - 44,
    size: 10,
    font: bold,
    color: C.navy,
  });

  // FIX #1 — bookingId already validated above; QR generation is now safe
  const qrPayload = record.bookingId;
  const qrPng = await QRCode.toBuffer(qrPayload, {
    type: "png",
    width: 360,
    margin: 1,
    errorCorrectionLevel: "H",
    color: { dark: "#0a1628", light: "#ffffff" },
  });
  const qrImage = await pdfDoc.embedPng(qrPng);
  const qrSize = 168;
  const qrX = W - m - qrSize;
  const qrTopFromTop = 142;
  const qrY = H - qrTopFromTop - qrSize;

  const cardPad = 28;
  const cardW = W - cardPad * 2;
  const cardBottomY = 64;
  const cardTopY = H - 128;
  const cardH = cardTopY - cardBottomY;
  const cardY = cardBottomY;

  page.drawRectangle({
    x: cardPad - 3,
    y: cardY - 3,
    width: cardW + 6,
    height: cardH + 6,
    color: C.cardShadow,
  });
  page.drawRectangle({
    x: cardPad,
    y: cardY,
    width: cardW,
    height: cardH,
    color: C.white,
    borderColor: C.border,
    borderWidth: 1,
  });

  const goldBarW = 4;
  page.drawRectangle({
    x: cardPad,
    y: cardY,
    width: goldBarW,
    height: cardH,
    color: C.gold,
  });

  const textLeft = cardPad + goldBarW + 18;
  const textMaxW = qrX - textLeft - 16;

  // FIX #5 — totalBarH is the green strip at the bottom of the card.
  // We must stop drawing rows before ty dips into it.
  const totalBarH = 52;
  const tyFloor = cardY + totalBarH + 14; // 14pt breathing room above the green bar

  let ty = cardTopY - 22;

  const row = (label: string, value: string, valueSize = 10.5): boolean => {
    // FIX #5 — Return false (stop) if we've run out of vertical space
    if (ty < tyFloor) return false;

    page.drawText(label.toUpperCase(), {
      x: textLeft,
      y: ty,
      size: 6.5,
      font: bold,
      color: C.muted,
    });
    ty -= 10;

    // FIX #3 — Sanitize user-supplied value before drawText
    const chunks = splitToWidth(sanitize(value), regular, valueSize, textMaxW);
    for (const chunk of chunks) {
      if (ty < tyFloor) break; // FIX #5 — clip mid-value if still overflowing
      page.drawText(chunk, {
        x: textLeft,
        y: ty,
        size: valueSize,
        font: regular,
        color: C.text,
      });
      ty -= valueSize + 5;
    }
    ty -= 6;
    return true;
  };

  row("Ticket ID (QR payload)", record.bookingId, 11);
  row("Guest", record.name);
  row("Phone", record.phone);
  if (record.email) {
    row("Email", record.email);
  }
  row(
    "Paid",
    DateTime.fromMillis(record.paidAt)
      .setZone("Africa/Nairobi")
      .toFormat("yyyy-MM-dd HH:mm:ss"),
  );
  row("Venue", record.venue);
  const refShort =
    record.reference.length > 140
      ? `${record.reference.slice(0, 137)}...`
      : record.reference;
  row("Payment reference", refShort);
  row("Admission", record.breakdown);

  page.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
  });

  page.drawText("Scan: ticket ID only", {
    x: qrX,
    y: qrY - 14,
    size: 7,
    font: bold,
    color: C.muted,
  });

  page.drawRectangle({
    x: cardPad,
    y: cardY,
    width: cardW,
    height: totalBarH,
    color: C.green,
  });
  page.drawText("TOTAL PAID", {
    x: textLeft,
    y: cardY + 18,
    size: 9,
    font: bold,
    color: C.white,
  });
  const amt = `KSh ${record.total.toLocaleString("en-KE")}`;
  const amtW = bold.widthOfTextAtSize(amt, 22);
  page.drawText(amt, {
    x: cardPad + cardW - amtW - 20,
    y: cardY + 12,
    size: 22,
    font: bold,
    color: C.white,
  });

  const foot = [
    "Show this ticket at the gate. Staff will scan the QR code - it contains only your ticket ID.",
    "Verify the ID against the event list / server before admission. Powered by Tixly.",
  ];
  let fy = cardBottomY - 22;
  for (const line of foot) {
    const parts = splitToWidth(line, regular, 8.2, W - m * 2);
    for (const p of parts) {
      const pw = regular.widthOfTextAtSize(p, 8.2);
      page.drawText(p, {
        x: (W - pw) / 2,
        y: fy,
        size: 8.2,
        font: regular,
        color: C.muted,
      });
      fy -= 11;
    }
    fy -= 2;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

/**
 * Persists the booking JSON and PDF ticket to Vercel Blob.
 * Skips upload if both blobs already exist (idempotent).
 * Requires BLOB_READ_WRITE_TOKEN in your Vercel environment variables.
 */
export async function persistPaidArtifacts(booking: Booking): Promise<void> {
  if (booking.status !== "PAID" || booking.paidAt == null) return;

  try {
    const pdfKey = blobPdfKey(booking.bookingId);

    const pdfExists = await head(pdfKey)
      .then(() => true)
      .catch(() => false);

    if (pdfExists) return; // already persisted, skip

    const record = buildPaidRecord(booking);
    const pdfBuffer = await renderPdf(record);

    // Upload PDF
    await put(pdfKey, pdfBuffer, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: false,
    });
  } catch (err) {
    console.error(
      `[persistPaidArtifacts] Failed to persist artifacts for bookingId="${booking.bookingId}":`,
      err,
    );
    throw err;
  }
}

/**
 * Reads the paid ticket PDF from Vercel Blob.
 * Returns null if either blob is missing or validation fails.
 */
export async function readPaidTicketPdfFromDisk(
  bookingId: string,
): Promise<Buffer | null> {
  try {
    const pdfKey = blobPdfKey(bookingId);

    const response = await get(pdfKey, { access: "public" });
    if (!response) return null;

    const { stream } = response;
    if (!stream) return null;

    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
