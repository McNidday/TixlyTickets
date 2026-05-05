import { NextResponse } from "next/server";
import { bookings } from "@/lib/store";
import { persistPaidArtifacts } from "@/lib/paid-artifacts";
import { appendToGoogleSheet } from "@/lib/google-sheets";

type RouteContext = { params: Promise<{ bookingId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { bookingId } = await context.params;
  const booking = bookings.get(bookingId);

  if (!booking) {
    return NextResponse.json(
      { message: "Booking not found." },
      { status: 404 },
    );
  }

  booking.status = "PAID";
  booking.paidAt = Date.now();
  bookings.set(booking.bookingId, booking);

  try {
    await persistPaidArtifacts(booking);
  } catch (err) {
    console.error("[paid-artifacts]", err);
  }

  try {
    await appendToGoogleSheet(booking);
  } catch (err) {
    console.error("[google-sheets]", err);
  }

  return NextResponse.json({
    bookingId: booking.bookingId,
    status: booking.status,
    paidAt: booking.paidAt,
    total: booking.total,
    breakdown: booking.breakdown,
    event: booking.event,
    venue: booking.venue,
    name: booking.name,
  });
}
