/** Shared by the signals form and the server so a reversed range is explained instead of applied. */

export function dateRangeError(from?: string | null, to?: string | null): string | null {
  const start = from?.trim() ?? "";
  const end = to?.trim() ?? "";
  if (start && Number.isNaN(Date.parse(start))) return "From is not a valid date. The date range was not applied.";
  if (end && Number.isNaN(Date.parse(end))) return "To is not a valid date. The date range was not applied.";
  if (start && end && Date.parse(start) > Date.parse(end)) return "From is after To. The date range was not applied.";
  return null;
}
