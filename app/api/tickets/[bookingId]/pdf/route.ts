import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { bookings } from "@/lib/store";
import {
  paidPdfPath,
  pathExists,
  persistPaidArtifacts,
  readPaidTicketPdfFromDisk,
} from "@/lib/paid-artifacts";

type RouteContext = { params: Promise<{ bookingId: string }> };

export const runtime = "nodejs";

function pdfResponse(buffer: Buffer, bookingId: string): NextResponse {
  const safeName = `ticket-${bookingId.replace(/[^\w.-]+/g, "_")}.pdf`;
  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const { bookingId } = await context.params;
  console.log("[ticket-pdf] Request for bookingId:", bookingId);

  const booking = bookings.get(bookingId);
  console.log(
    "[ticket-pdf] Found booking:",
    booking ? "yes" : "no",
    "status:",
    booking?.status,
  );

  // First check if booking exists and is PAID
  if (booking && booking.status === "PAID") {
    const pdfPath = paidPdfPath(bookingId);
    console.log("[ticket-pdf] Checking PDF at:", pdfPath);

    if (!(await pathExists(pdfPath))) {
      console.log("[ticket-pdf] PDF not found, generating...");
      try {
        await persistPaidArtifacts(booking);
        console.log("[ticket-pdf] PDF generated successfully");
      } catch (err) {
        console.error("[ticket-pdf] Error generating PDF:", err);
        return NextResponse.json(
          { message: "Could not generate ticket file." },
          { status: 500 },
        );
      }
    }

    if (!(await pathExists(pdfPath))) {
      return NextResponse.json(
        { message: "Ticket PDF missing." },
        { status: 404 },
      );
    }

    const buffer = await readFile(pdfPath);
    return pdfResponse(buffer, bookingId);
  }

  // If not in memory, try to load from disk
  console.log(
    "[ticket-pdf] Booking not in memory or not PAID, checking disk...",
  );
  const fromDisk = await readPaidTicketPdfFromDisk(bookingId);
  if (fromDisk) {
    console.log("[ticket-pdf] Found PDF on disk");
    return pdfResponse(fromDisk, bookingId);
  }

  console.log("[ticket-pdf] No ticket found");
  return NextResponse.json(
    { message: "Paid ticket not found or not confirmed yet." },
    { status: 404 },
  );
}
