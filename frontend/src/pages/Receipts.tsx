import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Receipt, Search, Filter } from "lucide-react";
import { api, type Document } from "../api/client";
import LoadingSpinner from "../components/LoadingSpinner";
import EmptyState from "../components/EmptyState";
import StatusBadge from "../components/StatusBadge";
import { formatDate, formatCurrency, formatDaysRemaining } from "../utils/format";

const WARRANTY_FILTERS = [
  { value: "", label: "All warranties" },
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRING_SOON", label: "Expiring Soon" },
  { value: "EXPIRED", label: "Expired" },
  { value: "NO_WARRANTY", label: "No Warranty" },
];

export default function Receipts() {
  const [receipts, setReceipts] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [merchantFilter, setMerchantFilter] = useState("");
  const [warrantyFilter, setWarrantyFilter] = useState("");

  const fetchReceipts = useCallback(async () => {
    try {
      const params: { merchant?: string; warrantyStatus?: string } = {};
      if (merchantFilter) params.merchant = merchantFilter;
      if (warrantyFilter) params.warrantyStatus = warrantyFilter;
      const result = await api.listReceipts(params);
      setReceipts(result.receipts ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }, [merchantFilter, warrantyFilter]);

  useEffect(() => {
    setLoading(true);
    void fetchReceipts();
  }, [fetchReceipts]);

  const filtered = useMemo(() => {
    if (!search.trim()) return receipts;
    const q = search.toLowerCase();
    return receipts.filter(
      (r) =>
        r.merchant?.toLowerCase().includes(q) ||
        r.productName?.toLowerCase().includes(q) ||
        (r.title || r.originalFilename).toLowerCase().includes(q)
    );
  }, [receipts, search]);

  const merchants = useMemo(() => {
    const set = new Set<string>();
    receipts.forEach((r) => {
      if (r.merchant) set.add(r.merchant);
    });
    return Array.from(set).sort();
  }, [receipts]);

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search receipts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <select
          value={merchantFilter}
          onChange={(e) => setMerchantFilter(e.target.value)}
          className="select-field"
        >
          <option value="">All merchants</option>
          {merchants.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={warrantyFilter}
          onChange={(e) => setWarrantyFilter(e.target.value)}
          className="select-field"
        >
          {WARRANTY_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingSpinner fullPage label="Loading receipts…" />
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-300 text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card">
          <EmptyState
            icon={receipts.length === 0 ? Receipt : Filter}
            title={receipts.length === 0 ? "No receipts yet" : "No matches found"}
            description={
              receipts.length === 0
                ? "Upload receipts to track purchases, returns, and warranties."
                : "Try adjusting your filters."
            }
          />
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-border">
                  <th className="text-left px-5 py-3 font-medium">Merchant</th>
                  <th className="text-left px-5 py-3 font-medium">Product</th>
                  <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Amount</th>
                  <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Purchase Date</th>
                  <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Return</th>
                  <th className="text-left px-5 py-3 font-medium">Warranty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr
                    key={r.documentId}
                    className="hover:bg-surface-2 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link
                        to={`/documents/${r.documentId}`}
                        className="text-white hover:text-primary-300 font-medium"
                      >
                        {r.merchant || "—"}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-300 truncate max-w-[200px]">
                      {r.productName || r.title || "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-300 hidden sm:table-cell">
                      {formatCurrency(r.amount, r.currency)}
                    </td>
                    <td className="px-5 py-3 text-gray-400 hidden md:table-cell">
                      {formatDate(r.purchaseDate || r.createdAt)}
                    </td>
                    <td className="px-5 py-3 hidden lg:table-cell">
                      {r.returnDaysRemaining != null ? (
                        <span className={`text-xs ${r.returnDaysRemaining <= 7 ? "text-orange-400" : "text-gray-400"}`}>
                          {formatDaysRemaining(r.returnDaysRemaining)}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {r.warrantyStatus ? (
                        <StatusBadge status={r.warrantyStatus} />
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-border text-xs text-gray-500">
            {filtered.length} receipt{filtered.length !== 1 ? "s" : ""}
          </div>
        </motion.div>
      )}
    </div>
  );
}
