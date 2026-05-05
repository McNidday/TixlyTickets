export function blobPdfKey(bookingId: string): string {
  const safeId = bookingId.replace(/[^\w.-]+/g, "_");
  return `${safeId}.pdf`;
}
