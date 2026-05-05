"use client";

import { useMemo, useState, useEffect, type CSSProperties } from "react";
import { DateTime } from "luxon";
import { EVENT_DATE } from "@/lib/event-config";
import { blobPdfKey } from "@/lib/blob-pd-key";

const EVENT_NAME = "KENYATTA UNIVERSITY ORCHESTRA";
const EVENT_SUBTITLE = "An Evening of Symphonic Excellence";
const EVENT_EYEBROW = "Kenyatta University Music Department";
const EVENT_VENUE = "CHINA SQUARE AUDITORIUM";

const TICKET_TYPES = [
  { name: "Student", price: 1, description: "carry student id" },
  {
    name: "Regular",
    price: 2,
    description: "General admission — all welcome",
  },
] as const;

type TicketName = (typeof TICKET_TYPES)[number]["name"];

type Quantities = Record<TicketName, number>;

type FormErrors = Partial<Record<"name" | "phone" | "tickets", string>>;

interface TicketBookingResponse {
  bookingId: string;
  status: string;
  tillNumber: string;
  amount: number;
  reference: string;
  event: string;
  venue: string;
  paidAt?: number | null;
}

interface PaymentStatusResponse {
  status: string;
  paidAt: number | null;
}

const fmt = (n: number) => `KSh ${Number(n).toLocaleString()}`;

function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  useEffect(() => {
    function update() {
      const now = DateTime.now().setZone("Africa/Nairobi");
      const diff = EVENT_DATE.diff(now);

      if (diff.toMillis() <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const {
        days = 0,
        hours = 0,
        minutes = 0,
        seconds = 0,
      } = diff.shiftTo("days", "hours", "minutes", "seconds").toObject();

      setTimeLeft({
        days: Math.floor(days),
        hours: Math.floor(hours),
        minutes: Math.floor(minutes),
        seconds: Math.floor(seconds),
      });
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  if (!timeLeft) return null;

  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <div className="countdown-timer">
      <div className="countdown-label">Event Starts In</div>
      <div className="countdown-units">
        <div className="countdown-unit">
          <span className="countdown-value">{timeLeft.days}</span>
          <span className="countdown-name">Days</span>
        </div>
        <div className="countdown-unit">
          <span className="countdown-value">{pad(timeLeft.hours)}</span>
          <span className="countdown-name">Hours</span>
        </div>
        <div className="countdown-unit">
          <span className="countdown-value">{pad(timeLeft.minutes)}</span>
          <span className="countdown-name">Mins</span>
        </div>
        <div className="countdown-unit">
          <span className="countdown-value">{pad(timeLeft.seconds)}</span>
          <span className="countdown-name">Secs</span>
        </div>
      </div>
    </div>
  );
}

const initialQuantities: Quantities = TICKET_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.name]: 0 }),
  {} as Quantities,
);

export default function HomePage() {
  const [quantities, setQuantities] = useState<Quantities>(initialQuantities);
  const [showModal, setShowModal] = useState(false);
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoadingPayment, setIsLoadingPayment] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [pdfDownloadError, setPdfDownloadError] = useState("");
  const [booking, setBooking] = useState<TicketBookingResponse | null>(null);

  const selectedTickets = useMemo(
    () =>
      TICKET_TYPES.filter((ticket) => quantities[ticket.name] > 0).map(
        (ticket) => ({
          name: ticket.name,
          quantity: quantities[ticket.name],
          price: ticket.price,
        }),
      ),
    [quantities],
  );

  const total = useMemo(
    () =>
      TICKET_TYPES.reduce(
        (sum, ticket) => sum + quantities[ticket.name] * ticket.price,
        0,
      ),
    [quantities],
  );

  const breakdown = useMemo(
    () =>
      selectedTickets
        .map((ticket) => `${ticket.quantity} ${ticket.name}`)
        .join(", "),
    [selectedTickets],
  );

  const stars = useMemo(
    () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: i,
        left: `${(i * 31) % 100}%`,
        top: `${(i * 17) % 60}%`,
        delay: `${(i % 6) * 0.3}s`,
      })),
    [],
  );

  function change(ticketName: TicketName, delta: number) {
    setQuantities((prev) => ({
      ...prev,
      [ticketName]: Math.max(0, prev[ticketName] + delta),
    }));
  }

  function openModal() {
    if (total <= 0) {
      setErrors({ tickets: "Select at least one ticket first." });
      return;
    }
    setErrors({});
    setShowModal(true);
    setShowPaymentStep(false);
    setServerMessage("");
    setPdfDownloadError("");
  }

  function closeModal() {
    if (isLoadingPayment) return;
    setShowModal(false);
  }

  async function pollPaymentStatus(
    bookingId: string,
  ): Promise<PaymentStatusResponse> {
    const POLL_DELAY = 3000;
    const MAX_POLLS = 40;

    for (let i = 0; i < MAX_POLLS; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_DELAY));
      const res = await fetch(`/api/payments/${bookingId}/status`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Could not verify payment status.");
      }

      const status = (await res.json()) as PaymentStatusResponse;
      if (status.status === "PAID") return status;
      if (status.status === "FAILED") {
        throw new Error("Payment failed. Please try again.");
      }
    }

    throw new Error("Payment confirmation timed out. Please try again.");
  }

  async function confirmDetails() {
    const nextErrors: FormErrors = {};
    const normalizedPhone = phone.replace(/\s/g, "");

    if (!name.trim()) {
      nextErrors.name = "Please enter your full name.";
    }
    if (!/^(07|01)\d{8}$/.test(normalizedPhone)) {
      nextErrors.phone = "Enter a valid Safaricom number (07xx or 01xx).";
    }
    if (total <= 0) {
      nextErrors.tickets = "Select at least one ticket.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      setIsLoadingPayment(true);
      setServerMessage("");

      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: normalizedPhone,
          email: email.trim(),
          tickets: selectedTickets,
        }),
      });
      const created = (await response.json()) as TicketBookingResponse & {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(created.message ?? "Could not create booking.");
      }

      setBooking(created);

      const paid = await pollPaymentStatus(created.bookingId);
      setBooking((prev) =>
        prev ? { ...prev, status: "PAID", paidAt: paid.paidAt } : prev,
      );
      setShowPaymentStep(true);
      setServerMessage("Payment confirmed. Your ticket is now active.");
    } catch (error: unknown) {
      setServerMessage(
        error instanceof Error ? error.message : "Payment check failed.",
      );
    } finally {
      setIsLoadingPayment(false);
    }
  }

  return (
    <>
      <div className="sky-world">
        <div className="stars">
          {stars.map((star) => {
            const style: CSSProperties = {
              left: star.left,
              top: star.top,
              animationDelay: star.delay,
            };
            return <span key={star.id} className="star" style={style} />;
          })}
        </div>
        <div className="sky-title-overlay">
          <div className="sky-eyebrow">{EVENT_EYEBROW}</div>
          <div className="sky-main-title">{EVENT_NAME}</div>
          <div className="sky-sub-title">{EVENT_SUBTITLE}</div>
        </div>
      </div>

      <div className="main-section">
        <div className="main">
          <div className="event-meta-bar">
            <div className="meta-pill">{EVENT_VENUE}</div>
            <div className="meta-pill">Instant Ticket Activation</div>
          </div>

          <CountdownTimer />

          <div className="section-label">Select Tickets</div>
          <div className="ticket-grid">
            {TICKET_TYPES.map((ticket) => (
              <div
                className={`ticket-card ${quantities[ticket.name] > 0 ? "active" : ""}`}
                key={ticket.name}
              >
                <div className="ticket-top">
                  <div className="ticket-name">{ticket.name}</div>
                  <div className="ticket-badge">Available</div>
                </div>
                <div className="ticket-price">
                  <span>KSh </span>
                  {ticket.price.toLocaleString()}
                </div>
                <div className="ticket-desc">{ticket.description}</div>
                <div className="qty-row">
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => change(ticket.name, -1)}
                  >
                    −
                  </button>
                  <span className="qty-val">{quantities[ticket.name]}</span>
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => change(ticket.name, 1)}
                  >
                    +
                  </button>
                  <span className="qty-sub">
                    {fmt(ticket.price * quantities[ticket.name])}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {total > 0 ? (
            <div className="summary-box">
              <div className="summary-rows">
                {selectedTickets.map((ticket) => (
                  <div className="s-row" key={ticket.name}>
                    <span>
                      {ticket.name} ({ticket.quantity} × {fmt(ticket.price)})
                    </span>
                    <span>{fmt(ticket.quantity * ticket.price)}</span>
                  </div>
                ))}
              </div>
              <div className="total-row">
                <span className="total-label">Total to Pay</span>
                <span className="total-val">{fmt(total)}</span>
              </div>
            </div>
          ) : null}
          {errors.tickets ? <p className="err show">{errors.tickets}</p> : null}
          <button
            type="button"
            className={`pay-btn ${total > 0 ? "visible" : ""}`}
            onClick={openModal}
          >
            Proceed to Pay via M-Pesa →
          </button>
        </div>
      </div>

      <footer>
        <div>
          {EVENT_NAME} · {EVENT_VENUE}
        </div>
        <div style={{ marginTop: 5 }}>
          Powered by <a href="#">Tixly</a> — Your ticket to everything
        </div>
      </footer>

      <div className={`sticky-bar ${total > 0 ? "visible" : ""}`}>
        <div className="sticky-total">
          <small>Total</small>
          <span>{fmt(total)}</span>
        </div>
        <button type="button" className="sticky-btn" onClick={openModal}>
          Pay via M-Pesa →
        </button>
      </div>

      <div
        className={`overlay ${showModal ? "show" : ""}`}
        onClick={closeModal}
        onKeyDown={(e) => e.key === "Escape" && closeModal()}
        role="presentation"
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div className="modal-handle" />
          {!showPaymentStep ? (
            <div>
              <div className="modal-title">Almost there 🎟️</div>
              <p className="modal-sub">
                Enter your details to generate your ticket and payment
                reference.
              </p>
              <div className="field">
                <label htmlFor="inp-name">Full Name</label>
                <input
                  id="inp-name"
                  type="text"
                  placeholder="e.g. Jane Wanjiku"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {errors.name ? (
                  <div className="err show">{errors.name}</div>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="inp-phone">Phone Number</label>
                <input
                  id="inp-phone"
                  type="tel"
                  placeholder="e.g. 0712 345 678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {errors.phone ? (
                  <div className="err show">{errors.phone}</div>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="inp-email">Email (optional)</label>
                <input
                  id="inp-email"
                  type="email"
                  placeholder="jane@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="modal-btn green"
                onClick={confirmDetails}
              >
                Generate My Ticket
              </button>
              <button
                type="button"
                className="modal-btn ghost"
                onClick={closeModal}
              >
                ← Back
              </button>
            </div>
          ) : (
            <div>
              <div className="modal-title">Pay & Enter 🎶</div>
              <p className="modal-sub">
                M-Pesa payment has been confirmed by the server. Your ticket is
                active.
              </p>
              <div className="pay-detail-box">
                <div className="pay-row">
                  <span className="lbl">Amount</span>
                  <span className="val green">{fmt(booking?.amount ?? 0)}</span>
                </div>
                <div className="pay-row">
                  <span className="lbl">Reference</span>
                  <span className="val">{booking?.reference}</span>
                </div>
                <div className="pay-row">
                  <span className="lbl">Booking ID</span>
                  <span className="val">{booking?.bookingId}</span>
                </div>
              </div>
              <div className="qr-note">
                <strong>Status:</strong> PAID
                <br />
                <strong>Name:</strong> {name}
                <br />
                <strong>Tickets:</strong> {breakdown}
              </div>
              {booking?.bookingId ? (
                <>
                  {/* FIX: button is disabled while downloading and shows a
                      loading label so the user knows something is happening. */}
                  <a
                    href={`${process.env.NEXT_TICKET_STORAGE_URL}/${blobPdfKey(booking.bookingId)}`}
                    download={`ticket-${blobPdfKey(booking.bookingId)}.pdf`}
                    className="modal-btn green"
                    style={{
                      display: "block",
                      textAlign: "center",
                      textDecoration: "none",
                    }}
                  >
                    {pdfDownloadError ? (
                      <div className="err show" style={{ marginTop: 10 }}>
                        {pdfDownloadError}
                      </div>
                    ) : null}
                  </a>
                </>
              ) : null}
              <button
                type="button"
                className="modal-btn ghost"
                style={{ marginTop: 12 }}
                onClick={closeModal}
              >
                ← Close
              </button>
            </div>
          )}
          {serverMessage ? <p className="modal-sub">{serverMessage}</p> : null}
        </div>
      </div>

      {isLoadingPayment ? (
        <div className="loadingOverlay">
          <div className="loadingCard">
            <div className="spinner" />
            <h3>Waiting for M-Pesa payment confirmation...</h3>
            <p>
              The server is verifying your payment. This screen remains visible
              until confirmation is found.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
