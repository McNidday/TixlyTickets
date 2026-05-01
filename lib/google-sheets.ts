import { google } from "googleapis";
import { DateTime } from "luxon";
import type { Booking } from "@/lib/store";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/**
 * Load Google Sheets credentials from environment variables.
 * Required env vars:
 *   - GOOGLE_CLIENT_EMAIL
 *   - GOOGLE_PRIVATE_KEY (with \n for newlines)
 *   - GOOGLE_PROJECT_ID
 *   - GOOGLE_PRIVATE_KEY_ID
 *   - GOOGLE_CLIENT_ID
 */
function loadCredentials() {
  const required = ["NEXT_GOOGLE_CLIENT_EMAIL", "NEXT_GOOGLE_PRIVATE_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  return {
    type: "service_account",
    project_id: process.env.NEXT_GOOGLE_PROJECT_ID,
    private_key_id: process.env.NEXT_GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.NEXT_GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.NEXT_GOOGLE_CLIENT_EMAIL,
    client_id: process.env.NEXT_GOOGLE_CLIENT_ID,
    auth_uri:
      process.env.NEXT_GOOGLE_AUTH_URI ||
      "https://accounts.google.com/o/oauth2/auth",
    token_uri:
      process.env.NEXT_GOOGLE_TOKEN_URI ||
      "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url:
      process.env.NEXT_GOOGLE_AUTH_PROVIDER_X509_CERT_URL ||
      "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.NEXT_GOOGLE_CLIENT_X509_CERT_URL,
    universe_domain:
      process.env.NEXT_GOOGLE_UNIVERSE_DOMAIN || "googleapis.com",
  };
}

function getSpreadsheetId(): string | undefined {
  return process.env.NEXT_GOOGLE_SHEETS_SPREADSHEET_ID;
}

export interface SheetRow {
  timestamp: string;
  bookingId: string;
  name: string;
  phone: string;
  email: string;
  tickets: string;
  total: number;
  paidAt: string;
  reference: string;
}

function formatPhoneNumber(phone: string | number) {
  // Convert to string and remove spaces or weird characters
  let cleaned = phone.toString().replace(/\D/g, "");

  // If it starts with 7 and has 9 digits → add leading 0
  if (cleaned.length === 9 && cleaned.startsWith("7")) {
    return "0" + cleaned;
  }

  // If already correct (10 digits starting with 0)
  if (cleaned.length === 10 && cleaned.startsWith("0")) {
    return cleaned;
  }

  // Optional: handle +254 or 254 formats
  if (cleaned.startsWith("254") && cleaned.length === 12) {
    return "0" + cleaned.slice(3);
  }

  // If none match, return null or original (your choice)
  return null;
}

export async function appendToGoogleSheet(booking: Booking): Promise<void> {
  const spreadsheetId = getSpreadsheetId();

  // Skip if spreadsheet ID not configured
  if (!spreadsheetId) {
    console.log("[google-sheets] Spreadsheet ID not configured, skipping");
    return;
  }

  // Check for required credentials
  let credentials;
  try {
    credentials = loadCredentials();
  } catch (err) {
    console.log("[google-sheets] Credentials not configured, skipping");
    return;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
    const sheets = google.sheets({ version: "v4", auth });

    const ticketDetails = booking.tickets
      .map((t) => `${t.quantity}x ${t.name}`)
      .join(", ");

    // Extract unique ticket types (STUDENT or REGULAR)
    const ticketTypes = [
      ...new Set(booking.tickets.map((t) => t.name.toUpperCase())),
    ];

    const row: (string | number)[] = [
      booking.name,
      formatPhoneNumber(booking.phone) || booking.phone,
      booking.email || "",
      booking.bookingId,
      ticketTypes.join(", "),
      ticketDetails,
      booking.total.toString(),
      booking.paidAt
        ? DateTime.fromMillis(booking.paidAt).toLocaleString(
            DateTime.DATETIME_FULL,
          )
        : "",
    ];

    console.log("[google-sheets] Appending row for booking", row);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A:A",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [row],
      },
    });

    console.log(
      "[google-sheets] Row appended successfully for",
      booking.bookingId,
    );
  } catch (err) {
    console.error("[google-sheets] Error appending to sheet:", err);
    // Don't throw - this is a non-critical feature
  }
}
