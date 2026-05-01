import { NextResponse } from "next/server";
import { createBooking } from "@/lib/store";
import { EVENT_NAME, EVENT_VENUE } from "@/lib/event-config";

interface TicketPayload {
  name: string;
  quantity: number;
  price: number;
}

interface CreateTicketBody {
  name?: string;
  phone?: string;
  email?: string;
  tickets?: TicketPayload[];
  type?: "STUDENT" | "GENERAL";
}

function formatTo254(phone: string) {
  if (!phone) return null;

  // Remove spaces or dashes just in case
  phone = phone.replace(/\D/g, "");

  if (phone.startsWith("254")) {
    return phone; // already correct
  }

  if (phone.startsWith("0")) {
    return "254" + phone.slice(1);
  }

  if (phone.startsWith("7")) {
    return "254" + phone;
  }

  return phone; // fallback (in case of unexpected format)
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateTicketBody;
    const { name, phone, email, tickets, type } = body;

    if (!name || !phone || !Array.isArray(tickets) || tickets.length === 0) {
      return NextResponse.json(
        { message: "Missing required booking fields." },
        { status: 400 },
      );
    }

    if (!/^(07|01)\d{8}$/.test(phone)) {
      return NextResponse.json(
        { message: "Enter a valid Safaricom phone number." },
        { status: 400 },
      );
    }

    const total = tickets.reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0,
    );

    if (total <= 0) {
      return NextResponse.json(
        { message: "Ticket total must be greater than zero." },
        { status: 400 },
      );
    }

    const breakdown = tickets
      .map((item) => `${item.quantity} ${item.name}`)
      .join(", ");

    const booking = createBooking({
      name,
      phone,
      email: email ?? "",
      tickets,
      total,
      breakdown,
      event: EVENT_NAME,
      venue: EVENT_VENUE,
      type: type ?? "GENERAL",
    });

    const url = process.env.NEXT_PAYMENT_SERVER_URL || "";

    const mutation = `
      mutation TicketPayment($amount: Int!, $phoneNumber: String!, $username: String!, $ticketId: String!) {
        ticketPayment(
          amount: $amount
          phoneNumber: $phoneNumber
          username: $username
          ticketId: $ticketId
        )
      }
`;

    const variables = {
      amount: booking.total,
      phoneNumber: formatTo254(booking.phone),
      username: booking.name,
      ticketId: booking.bookingId,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: variables,
      }),
    });

    if (response.status !== 200) {
      throw new Error("Could not create booking.");
    }

    return NextResponse.json({
      bookingId: booking.bookingId,
      status: booking.status,
      amount: booking.total,
      reference: `${booking.name} - ${booking.breakdown}`,
      event: EVENT_NAME,
      venue: EVENT_VENUE,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "Could not create booking." },
      { status: 500 },
    );
  }
}
