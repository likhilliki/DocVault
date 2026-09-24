import { format, formatDistanceToNow, parseISO, isValid } from "date-fns";

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? parseISO(value) : value;
  if (!isValid(date)) return value;
  return format(date, "MMM d, yyyy");
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = parseISO(value);
  if (!isValid(date)) return value;
  return format(date, "MMM d, yyyy h:mm a");
}

export function formatRelative(value?: string | null): string {
  if (!value) return "—";
  const date = parseISO(value);
  if (!isValid(date)) return value;
  return formatDistanceToNow(date, { addSuffix: true });
}

export function formatCurrency(
  amount?: number | null,
  currency = "USD"
): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatFileSize(bytes?: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDaysRemaining(days?: number | null): string {
  if (days == null) return "—";
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
