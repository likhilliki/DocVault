import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FileText,
  Receipt,
  Shield,
  AlertTriangle,
  Clock,
  XCircle,
  ChevronRight,
  Upload,
} from "lucide-react";
import { api, type DashboardData, type Document, type AttentionItem } from "../api/client";
import LoadingSpinner from "../components/LoadingSpinner";
import EmptyState from "../components/EmptyState";
import StatusBadge from "../components/StatusBadge";
import { formatDate, formatRelative, formatDaysRemaining } from "../utils/format";

function normalizeDashboard(raw: Partial<DashboardData> & Record<string, unknown>): DashboardData {
  const statsRaw = (raw.stats ?? {}) as Record<string, unknown>;
  return {
    stats: {
      totalDocuments: Number(
        statsRaw.totalDocuments ?? statsRaw.total ?? statsRaw.totalAll ?? 0
      ),
      totalReceipts: Number(statsRaw.totalReceipts ?? statsRaw.receipts ?? 0),
      totalAll: Number(statsRaw.totalAll ?? statsRaw.total ?? statsRaw.totalDocuments ?? 0),
      processingCount: Number(statsRaw.processingCount ?? statsRaw.processing ?? 0),
      activeWarranties: Number(statsRaw.activeWarranties ?? statsRaw.active ?? 0),
      expiringSoon: Number(statsRaw.expiringSoon ?? statsRaw.expiring ?? 0),
      expiredWarranties: Number(statsRaw.expiredWarranties ?? statsRaw.expired ?? 0),
      attentionRequired: Number(statsRaw.attentionRequired ?? statsRaw.attention ?? 0),
    },
    recentDocuments: (raw.recentDocuments ?? raw.documents ?? []) as Document[],
    recentReceipts: (raw.recentReceipts ?? raw.receipts ?? []) as Document[],
    attentionItems: (raw.attentionItems ?? raw.attention ?? []) as AttentionItem[],
    expiringSoonWarranties: (raw.expiringSoonWarranties ?? []) as DashboardData["expiringSoonWarranties"],
  };
}

const statCards = [
  { key: "totalDocuments", label: "Total Documents", icon: FileText, color: "text-primary-400", bg: "bg-primary-500/10" },
  { key: "totalReceipts", label: "Receipts", icon: Receipt, color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "activeWarranties", label: "Active Warranties", icon: Shield, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { key: "expiringSoon", label: "Expiring Soon", icon: Clock, color: "text-orange-400", bg: "bg-orange-500/10" },
  { key: "expiredWarranties", label: "Expired", icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
] as const;

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDashboard()
      .then((raw) => setData(normalizeDashboard(raw as DashboardData & Record<string, unknown>)))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load dashboard")
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage label="Loading dashboard…" />;

  if (error) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center">
          <AlertTriangle size={24} className="text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, recentDocuments, recentReceipts, attentionItems } = data;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {statCards.map(({ key, label, icon: Icon, color, bg }, i) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon size={17} className={color} />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">
              {stats[key]}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </motion.div>
        ))}
      </div>

      {stats.processingCount > 0 && (
        <div className="glass-card p-4 flex items-center gap-3 border-blue-500/20">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <p className="text-sm text-blue-300">
            {stats.processingCount} document{stats.processingCount !== 1 ? "s" : ""} processing…
          </p>
          <Link to="/documents?status=PROCESSING" className="ml-auto text-xs text-primary-400 hover:text-primary-300">
            View →
          </Link>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Attention Required */}
        <section className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-400" />
              <h2 className="text-sm font-semibold text-white">Attention Required</h2>
              {attentionItems.length > 0 && (
                <span className="badge-orange">{attentionItems.length}</span>
              )}
            </div>
            <Link to="/warranties" className="text-xs text-gray-500 hover:text-primary-400">
              View all
            </Link>
          </div>
          {attentionItems.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="All clear"
              description="No warranties or documents need your attention right now."
            />
          ) : (
            <ul className="divide-y divide-border">
              {attentionItems.map((item) => (
                <li key={item.documentId}>
                  <Link
                    to={`/documents/${item.documentId}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-gray-500">{item.reason}</p>
                    </div>
                    <span className="badge-orange flex-shrink-0">
                      {formatDaysRemaining(item.daysRemaining)}
                    </span>
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

        {/* Recent Uploads */}
        <section className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Upload size={16} className="text-primary-400" />
              <h2 className="text-sm font-semibold text-white">Recent Uploads</h2>
            </div>
            <Link to="/documents" className="text-xs text-gray-500 hover:text-primary-400">
              View all
            </Link>
          </div>
          {recentDocuments.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description="Upload your first document to get started."
              action={{ label: "Upload Document", onClick: () => window.location.assign("/documents") }}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentDocuments.slice(0, 5).map((doc) => (
                <li key={doc.documentId}>
                  <Link
                    to={`/documents/${doc.documentId}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {doc.title || doc.originalFilename}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatRelative(doc.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={doc.status} />
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
      </div>

      {/* Recent Receipts */}
      <section className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Recent Receipts</h2>
          </div>
          <Link to="/receipts" className="text-xs text-gray-500 hover:text-primary-400">
            View all
          </Link>
        </div>
        {recentReceipts.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No receipts yet"
            description="Upload receipts to track purchases and warranties."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-border">
                  <th className="text-left px-5 py-3 font-medium">Merchant</th>
                  <th className="text-left px-5 py-3 font-medium">Product</th>
                  <th className="text-left px-5 py-3 font-medium">Date</th>
                  <th className="text-left px-5 py-3 font-medium">Warranty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentReceipts.slice(0, 5).map((r) => (
                  <tr
                    key={r.documentId}
                    className="hover:bg-surface-2 transition-colors cursor-pointer"
                    onClick={() => window.location.assign(`/documents/${r.documentId}`)}
                  >
                    <td className="px-5 py-3 text-white">{r.merchant || "—"}</td>
                    <td className="px-5 py-3 text-gray-300 truncate max-w-[180px]">
                      {r.productName || r.title || "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-400">
                      {formatDate(r.purchaseDate || r.createdAt)}
                    </td>
                    <td className="px-5 py-3">
                      {r.warrantyStatus ? (
                        <StatusBadge status={r.warrantyStatus} />
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
