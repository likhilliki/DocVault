import { useEffect, useState, type ElementType } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, Clock, XCircle, ChevronRight } from "lucide-react";
import { api, type WarrantyData, type WarrantyItem } from "../api/client";
import LoadingSpinner from "../components/LoadingSpinner";
import EmptyState from "../components/EmptyState";
import StatusBadge from "../components/StatusBadge";
import { formatDate, formatDaysRemaining } from "../utils/format";

function normalizeWarrantyData(raw: Partial<WarrantyData> & Record<string, unknown>): WarrantyData {
  const statsRaw = (raw.stats ?? {}) as Record<string, unknown>;
  return {
    stats: {
      active: Number(statsRaw.active ?? (raw.active as WarrantyItem[])?.length ?? 0),
      expiringSoon: Number(statsRaw.expiringSoon ?? (raw.expiringSoon as WarrantyItem[])?.length ?? 0),
      expired: Number(statsRaw.expired ?? (raw.expired as WarrantyItem[])?.length ?? 0),
    },
    active: (raw.active ?? []) as WarrantyItem[],
    expiringSoon: (raw.expiringSoon ?? raw.expiring ?? []) as WarrantyItem[],
    expired: (raw.expired ?? []) as WarrantyItem[],
  };
}

interface WarrantySectionProps {
  title: string;
  icon: ElementType;
  iconColor: string;
  items: WarrantyItem[];
  emptyMessage: string;
}

function WarrantySection({
  title,
  icon: Icon,
  iconColor,
  items,
  emptyMessage,
}: WarrantySectionProps) {
  return (
    <section className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Icon size={16} className={iconColor} />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className="badge-gray ml-1">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500 text-center">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.documentId}>
              <Link
                to={`/documents/${item.documentId}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    {item.merchant && <span>{item.merchant}</span>}
                    {item.purchaseDate && (
                      <span>Purchased {formatDate(item.purchaseDate)}</span>
                    )}
                    {item.serialNumber && (
                      <span className="font-mono">S/N {item.serialNumber}</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <StatusBadge status={item.warrantyStatus} />
                  <p className="text-xs text-gray-500 mt-1">
                    {item.warrantyStatus === "EXPIRED"
                      ? `Ended ${formatDate(item.warrantyEndDate)}`
                      : `${formatDaysRemaining(item.daysRemaining)} left`}
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className="text-gray-600 group-hover:text-gray-400 flex-shrink-0"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Warranties() {
  const [data, setData] = useState<WarrantyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getWarranties()
      .then((raw) => setData(normalizeWarrantyData(raw as WarrantyData & Record<string, unknown>)))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load warranties")
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage label="Loading warranties…" />;

  if (error) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center text-red-300 text-sm">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const totalItems = data.active.length + data.expiringSoon.length + data.expired.length;

  if (totalItems === 0) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto">
        <div className="glass-card">
          <EmptyState
            icon={Shield}
            title="No warranties tracked"
            description="Upload receipts with warranty information to track coverage and expiry dates."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active", value: data.stats.active, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Expiring Soon", value: data.stats.expiringSoon, color: "text-orange-400", bg: "bg-orange-500/10" },
          { label: "Expired", value: data.stats.expired, color: "text-red-400", bg: "bg-red-500/10" },
        ].map(({ label, value, color, bg }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-4 text-center"
          >
            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mx-auto mb-2`}>
              <Shield size={15} className={color} />
            </div>
            <p className="text-xl font-bold text-white">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </motion.div>
        ))}
      </div>

      <WarrantySection
        title="Expiring Soon"
        icon={Clock}
        iconColor="text-orange-400"
        items={data.expiringSoon}
        emptyMessage="No warranties expiring in the next 30 days."
      />

      <WarrantySection
        title="Active"
        icon={Shield}
        iconColor="text-emerald-400"
        items={data.active}
        emptyMessage="No active warranties."
      />

      <WarrantySection
        title="Expired"
        icon={XCircle}
        iconColor="text-red-400"
        items={data.expired}
        emptyMessage="No expired warranties."
      />
    </div>
  );
}
