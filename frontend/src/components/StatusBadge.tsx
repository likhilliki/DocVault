import type { Document } from "../api/client";

type StatusType =
  | Document["status"]
  | Document["warrantyStatus"]
  | "REVOKED"
  | "ACTIVE_SHARE"
  | "EXPIRED_SHARE";

interface StatusBadgeProps {
  status: StatusType | string;
  className?: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  PENDING_UPLOAD: { label: "Pending", className: "badge-gray" },
  PROCESSING: { label: "Processing", className: "badge-blue" },
  READY: { label: "Ready", className: "badge-green" },
  FAILED: { label: "Failed", className: "badge-red" },
  ACTIVE: { label: "Active", className: "badge-green" },
  EXPIRING_SOON: { label: "Expiring Soon", className: "badge-orange" },
  EXPIRED: { label: "Expired", className: "badge-red" },
  NO_WARRANTY: { label: "No Warranty", className: "badge-gray" },
  REVOKED: { label: "Revoked", className: "badge-red" },
  ACTIVE_SHARE: { label: "Active", className: "badge-green" },
  EXPIRED_SHARE: { label: "Expired", className: "badge-gray" },
};

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status as string] ?? {
    label: String(status).replace(/_/g, " "),
    className: "badge-gray",
  };

  return (
    <span className={`${config.className} ${className}`}>
      {status === "PROCESSING" && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5 animate-pulse" />
      )}
      {config.label}
    </span>
  );
}
