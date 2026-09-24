import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FileText,
  Search,
  LayoutGrid,
  List,
  Upload,
  Filter,
} from "lucide-react";
import { api, type Document } from "../api/client";
import LoadingSpinner from "../components/LoadingSpinner";
import EmptyState from "../components/EmptyState";
import StatusBadge from "../components/StatusBadge";
import UploadModal from "../components/UploadModal";
import { usePolling } from "../hooks/usePolling";
import { formatDate, formatFileSize, formatRelative } from "../utils/format";

const DOCUMENT_TYPES = [
  "RECEIPT", "INVOICE", "PASSPORT", "ID_CARD", "INSURANCE",
  "WARRANTY", "CONTRACT", "MEDICAL", "BANK", "OTHER",
] as const;

const STATUSES = ["PENDING_UPLOAD", "PROCESSING", "READY", "FAILED"] as const;

export default function Documents() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const typeFilter = searchParams.get("type") || "";
  const statusFilter = searchParams.get("status") || "";
  const searchQuery = searchParams.get("q") || "";

  const fetchDocuments = useCallback(async () => {
    try {
      const params: { type?: string; status?: string } = {};
      if (typeFilter) params.type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const result = await api.listDocuments(params);
      setDocuments(result.documents ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    setLoading(true);
    void fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    const state = location.state as { openUpload?: boolean } | null;
    if (state?.openUpload) {
      setUploadOpen(true);
      window.history.replaceState({}, "");
    }
  }, [location.state]);

  const hasProcessing = documents.some(
    (d) => d.status === "PROCESSING" || d.status === "PENDING_UPLOAD"
  );

  usePolling(fetchDocuments, {
    enabled: hasProcessing,
    interval: 4000,
    immediate: false,
  });

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(
      (d) =>
        (d.title || d.originalFilename).toLowerCase().includes(q) ||
        d.merchant?.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q) ||
        d.documentType?.toLowerCase().includes(q)
    );
  }, [documents, searchQuery]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const handleUploadSuccess = () => {
    void fetchDocuments();
  };

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search documents…"
            value={searchQuery}
            onChange={(e) => updateFilter("q", e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => updateFilter("type", e.target.value)}
            className="select-field"
          >
            <option value="">All types</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => updateFilter("status", e.target.value)}
            className="select-field"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <div className="flex border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 ${viewMode === "grid" ? "bg-primary-500/10 text-primary-400" : "text-gray-500 hover:text-white"}`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 ${viewMode === "list" ? "bg-primary-500/10 text-primary-400" : "text-gray-500 hover:text-white"}`}
            >
              <List size={16} />
            </button>
          </div>
          <button onClick={() => setUploadOpen(true)} className="btn-primary">
            <Upload size={15} />
            Upload
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner fullPage label="Loading documents…" />
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-300 text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card">
          <EmptyState
            icon={documents.length === 0 ? FileText : Filter}
            title={documents.length === 0 ? "No documents yet" : "No matches found"}
            description={
              documents.length === 0
                ? "Upload PDFs and images to your encrypted vault."
                : "Try adjusting your filters or search query."
            }
            action={
              documents.length === 0
                ? { label: "Upload Document", onClick: () => setUploadOpen(true) }
                : undefined
            }
          />
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((doc, i) => (
            <motion.div
              key={doc.documentId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link
                to={`/documents/${doc.documentId}`}
                className="glass-card-hover p-4 block h-full group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center">
                    <FileText size={18} className="text-primary-400" />
                  </div>
                  <StatusBadge status={doc.status} />
                </div>
                <h3 className="text-sm font-medium text-white truncate group-hover:text-primary-300 transition-colors">
                  {doc.title || doc.originalFilename}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {doc.documentType?.replace(/_/g, " ") || doc.category}
                </p>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <span className="text-xs text-gray-500">
                    {formatRelative(doc.createdAt)}
                  </span>
                  <span className="text-xs text-gray-600">
                    {formatFileSize(doc.size)}
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-border">
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Type</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Size</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Uploaded</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((doc) => (
                <tr
                  key={doc.documentId}
                  className="hover:bg-surface-2 transition-colors"
                >
                  <td className="px-5 py-3">
                    <Link
                      to={`/documents/${doc.documentId}`}
                      className="text-white hover:text-primary-300 font-medium truncate block max-w-[240px]"
                    >
                      {doc.title || doc.originalFilename}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-400 hidden sm:table-cell">
                    {doc.documentType?.replace(/_/g, " ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-500 hidden md:table-cell">
                    {formatFileSize(doc.size)}
                  </td>
                  <td className="px-5 py-3 text-gray-500 hidden md:table-cell">
                    {formatDate(doc.createdAt)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={doc.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={handleUploadSuccess}
      />
    </div>
  );
}
