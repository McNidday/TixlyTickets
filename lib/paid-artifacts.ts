import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import type { Booking } from "@/lib/store";

const PAID_DIR = path.join(process.cwd(), "data", "paid");

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

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
 */
async function renderPdf(record: PaidBookingJson): Promise<Buffer> {
  const W = 595.28;
  const H = 841.89;
  const m = 40;
  const headerH = 118;
  const goldStrip = 4;

  const pdfDoc = await PDFDocument.create();
  const page: PDFPage = pdfDoc.addPage([W, H]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

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

  const titleLines = splitToWidth(
    record.event.toUpperCase(),
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
  /** Card: upper edge 128pt below page top; lower edge 64pt above page bottom */
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
  let ty = cardTopY - 22;

  const row = (label: string, value: string, valueSize = 10.5) => {
    page.drawText(label.toUpperCase(), {
      x: textLeft,
      y: ty,
      size: 6.5,
      font: bold,
      color: C.muted,
    });
    ty -= 10;
    const chunks = splitToWidth(value, regular, valueSize, textMaxW);
    for (const chunk of chunks) {
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
  };

  row("Ticket ID (QR payload)", record.bookingId, 11);
  row("Guest", record.name);
  row("Phone", record.phone);
  if (record.email) {
    row("Email", record.email);
  }
  row("Paid", DateTime.fromMillis(record.paidAt).setZone("Africa/Nairobi").toFormat("yyyy-MM-dd HH:mm:ss"));
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

  const totalBarH = 52;
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

export async function persistPaidArtifacts(booking: Booking): Promise<void> {
  if (booking.status !== "PAID" || booking.paidAt == null) {
    return;
  }

  await mkdir(PAID_DIR, { recursive: true });

  const safeId = booking.bookingId.replace(/[^\w.-]+/g, "_");
  const jsonPath = path.join(PAID_DIR, `${safeId}.json`);
  const pdfPath = path.join(PAID_DIR, `${safeId}.pdf`);

  if ((await pathExists(jsonPath)) && (await pathExists(pdfPath))) {
    return;
  }

  const record = buildPaidRecord(booking);
  const pdfBuffer = await renderPdf(record);

  await writeFile(jsonPath, JSON.stringify(record, null, 2), "utf8");
  await writeFile(pdfPath, pdfBuffer);
}

export function paidJsonPath(bookingId: string): string {
  const safeId = bookingId.replace(/[^\w.-]+/g, "_");
  return path.join(PAID_DIR, `${safeId}.json`);
}

export function paidPdfPath(bookingId: string): string {
  const safeId = bookingId.replace(/[^\w.-]+/g, "_");
  return path.join(PAID_DIR, `${safeId}.pdf`);
}

/**
 * Serves a paid ticket PDF from disk when the in-memory Map no longer has the booking
 * (e.g. dev server restart). Validates the JSON snapshot is PAID and matches bookingId.
 */
export async function readPaidTicketPdfFromDisk(
  bookingId: string,
): Promise<Buffer | null> {
  const jsonPath = paidJsonPath(bookingId);
  const pdfPath = paidPdfPath(bookingId);
  if (!(await pathExists(jsonPath)) || !(await pathExists(pdfPath))) {
    return null;
  }
  try {
    const raw = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as PaidBookingJson;
    if (parsed.status !== "PAID" || parsed.bookingId !== bookingId) {
      return null;
    }
  } catch {
    return null;
  }
  return readFile(pdfPath);
}
