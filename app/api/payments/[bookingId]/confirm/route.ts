import { NextResponse } from "next/server";
import { bookings } from "@/lib/store";
import { persistPaidArtifacts } from "@/lib/paid-artifacts";
import { appendToGoogleSheet } from "@/lib/google-sheets";

type RouteContext = { params: Promise<{ bookingId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { bookingId } = await context.params;

  // 👇 Extract query params
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const booking = bookings.get(bookingId);

  if (!booking) {
    console.error(`Booking not found: ${bookingId}`);
    return NextResponse.json(
      { message: "Booking not found." },
      { status: 404 },
    );
  }

  if (status !== "PAID") {
    booking.status = "FAILED";
    booking.paidAt = Date.now();
    bookings.set(booking.bookingId, booking);
  } else {
    booking.status = "PAID";
    booking.paidAt = Date.now();
    bookings.set(booking.bookingId, booking);
  }

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
  });
}
