import { NextResponse } from "next/server";
import { bookings } from "@/lib/store";

type RouteContext = { params: Promise<{ bookingId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { bookingId } = await context.params;
  const booking = bookings.get(bookingId);

  if (!booking) {
    console.error(`Booking not found: ${bookingId}`);
    return NextResponse.json(
      { message: "Booking not found." },
      { status: 404 },
    );
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
