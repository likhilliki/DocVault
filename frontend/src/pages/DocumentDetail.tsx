import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Download,
  Trash2,
  Share2,
  Edit3,
  X,
  Clock,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { api, type Document, type AuditEvent } from "../api/client";
import LoadingSpinner from "../components/LoadingSpinner";
import StatusBadge from "../components/StatusBadge";
import ShareModal from "../components/ShareModal";
import { usePolling } from "../hooks/usePolling";
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatCurrency,
  formatDaysRemaining,
} from "../utils/format";

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Document | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", category: "", summary: "" });

  const fetchDoc = useCallback(async () => {
    if (!id) return;
    try {
      const [document, auditData] = await Promise.all([
        api.getDocument(id),
        api.getAuditHistory(id).catch(() => ({ events: [] })),
      ]);
      setDoc(document);
      setAudit(auditData.events ?? []);
      setEditForm({
        title: document.title || document.originalFilename || "",
        category: document.category || "",
        summary: document.summary || "",
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document not found");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchDoc();
  }, [fetchDoc]);

  usePolling(fetchDoc, {
    enabled: doc?.status === "PROCESSING" || doc?.status === "PENDING_UPLOAD",
    interval: 4000,
    immediate: false,
  });

  const handleDownload = async () => {
    if (!id) return;
    try {
      const { downloadUrl, filename } = await api.getDownloadUrl(id);
      // Must append to DOM before click for Firefox/Safari cross-origin presigned URLs
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename || "document";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api.deleteDocument(id);
      navigate("/documents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    setSaving(true);
    setEditError(null);
    try {
      const updated = await api.updateDocument(id, {
        title: editForm.title,
        category: editForm.category,
        summary: editForm.summary,
      });
      setDoc(updated);
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Update failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner fullPage label="Loading document…" />;

  if (error || !doc) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link to="/documents" className="btn-ghost mb-4 inline-flex">
          <ArrowLeft size={16} /> Back
        </Link>
        <div className="glass-card p-8 text-center">
          <AlertTriangle size={24} className="text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-300">{error || "Document not found"}</p>
        </div>
      </div>
    );
  }

  const isImage = doc.mimeType?.startsWith("image/");
  const extractedFields: Array<{ label: string; value: string }> = [];

  const addField = (label: string, value?: string | number | null) => {
    if (value != null && value !== "") {
      extractedFields.push({ label, value: String(value) });
    }
  };

  addField("Merchant", doc.merchant);
  addField("Product", doc.productName);
  addField("Amount", doc.amount != null ? formatCurrency(doc.amount, doc.currency) : null);
  addField("Purchase Date", doc.purchaseDate ? formatDate(doc.purchaseDate) : null);
  addField("Invoice #", doc.invoiceNumber);
  addField("Receipt #", doc.receiptNumber);
  addField("Serial #", doc.serialNumber);
  addField("Warranty Period", doc.warrantyPeriod);
  addField("Warranty Start", doc.warrantyStartDate ? formatDate(doc.warrantyStartDate) : null);
  addField("Warranty End", doc.warrantyEndDate ? formatDate(doc.warrantyEndDate) : null);
  addField("Warranty Status", doc.warrantyStatus);
  addField("Days Remaining", doc.warrantyDaysRemaining != null ? formatDaysRemaining(doc.warrantyDaysRemaining) : null);
  addField("Return Deadline", doc.returnDeadline ? formatDate(doc.returnDeadline) : null);
  addField("Issuer", doc.issuer);
  addField("Document #", doc.documentNumber);
  addField("Issue Date", doc.issueDate ? formatDate(doc.issueDate) : null);
  addField("Expiry Date", doc.expiryDate ? formatDate(doc.expiryDate) : null);
  addField("Person", doc.personName);
  addField("Organization", doc.organization);
  addField("Payment Method", doc.paymentMethod);
  addField("Seller", doc.seller);

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <Link to="/documents" className="btn-ghost self-start">
          <ArrowLeft size={16} /> Documents
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white truncate">
              {doc.title || doc.originalFilename}
            </h1>
            <StatusBadge status={doc.status} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {doc.documentType?.replace(/_/g, " ")} · {formatFileSize(doc.size)} ·{" "}
            {formatDate(doc.createdAt)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setEditOpen(true)} className="btn-secondary">
            <Edit3 size={15} /> Edit
          </button>
          <button onClick={handleDownload} className="btn-secondary" disabled={doc.status !== "READY"}>
            <Download size={15} /> Download
          </button>
          <button onClick={() => setShareOpen(true)} className="btn-secondary" disabled={doc.status !== "READY"}>
            <Share2 size={15} /> Share
          </button>
          <button onClick={() => setDeleteConfirm(true)} className="btn-danger">
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Preview */}
        <div className="lg:col-span-3 glass-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <FileText size={15} className="text-gray-500" />
            <span className="text-xs text-gray-500">Preview</span>
          </div>
          <div className="min-h-[400px] bg-surface-2 flex items-center justify-center">
            {doc.status === "PROCESSING" || doc.status === "PENDING_UPLOAD" ? (
              <div className="text-center p-8">
                <LoadingSpinner label="Processing document…" />
                <p className="text-xs text-gray-500 mt-4">
                  AI extraction in progress. This page will update automatically.
                </p>
              </div>
            ) : doc.status === "FAILED" ? (
              <div className="text-center p-8">
                <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
                <p className="text-sm text-red-300">Processing failed</p>
                <p className="text-xs text-gray-500 mt-1">Try re-uploading this document.</p>
              </div>
            ) : doc.viewUrl ? (
              isImage ? (
                <img
                  src={doc.viewUrl}
                  alt={doc.title || doc.originalFilename}
                  className="max-w-full max-h-[600px] object-contain"
                />
              ) : (
                <iframe
                  src={doc.viewUrl}
                  title="Document preview"
                  className="w-full h-[600px] border-0"
                />
              )
            ) : (
              <p className="text-sm text-gray-500">Preview unavailable</p>
            )}
          </div>
        </div>

        {/* Metadata sidebar */}
        <div className="lg:col-span-2 space-y-4">
          {doc.summary && (
            <div className="glass-card p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Summary
              </h3>
              <p className="text-sm text-gray-300 leading-relaxed">{doc.summary}</p>
            </div>
          )}

          {extractedFields.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Extracted Fields
              </h3>
              <dl className="space-y-2">
                {extractedFields.map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-3 text-sm">
                    <dt className="text-gray-500 flex-shrink-0">{label}</dt>
                    <dd className="text-white text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {doc.keywords && doc.keywords.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Keywords
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {doc.keywords.map((kw) => (
                  <span key={kw} className="badge-indigo">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {doc.importantDates && doc.importantDates.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Important Dates
              </h3>
              <ul className="space-y-2">
                {doc.importantDates.map((d, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-gray-400">{d.description}</span>
                    <span className="text-white">{formatDate(d.date)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Audit history */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-gray-500" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Audit History
              </h3>
            </div>
            {audit.length === 0 ? (
              <p className="text-xs text-gray-500">No audit events recorded.</p>
            ) : (
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {audit.map((event) => (
                  <li key={event.eventId} className="text-xs">
                    <span className="text-white">{event.action}</span>
                    <span className="text-gray-500 ml-2">
                      {formatDateTime(event.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => !saving && setEditOpen(false)}
            />
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-6 sm:py-16">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="glass-card p-6 shadow-2xl">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-semibold text-white">Edit Metadata</h2>
                    <button
                      onClick={() => setEditOpen(false)}
                      disabled={saving}
                      className="btn-ghost p-1.5 disabled:opacity-40"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {editError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-xs text-red-300">{editError}</p>
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Title</label>
                      <input
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        className="input-field"
                        placeholder="Document title"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Category</label>
                      <select
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className="select-field w-full"
                      >
                        <option value="">— Select category —</option>
                        {["IDENTITY","EDUCATION","EMPLOYMENT","FINANCIAL","INSURANCE","PURCHASE","WARRANTY","MEDICAL_DOCUMENT","LEGAL","TRAVEL","TAX","OTHER"].map(c => (
                          <option key={c} value={c}>{c.replace(/_/g," ")}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Summary</label>
                      <textarea
                        value={editForm.summary}
                        onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                        rows={4}
                        className="input-field resize-none"
                        placeholder="Brief description of this document"
                      />
                    </div>
                    <div className="flex gap-3 pt-1">
                      <button
                        onClick={() => { setEditOpen(false); setEditError(null); }}
                        disabled={saving}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="btn-primary flex-1 justify-center disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => !deleting && setDeleteConfirm(false)}
            />
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-16">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="glass-card p-6 text-center shadow-2xl">
                  <Trash2 size={28} className="text-red-400 mx-auto mb-3" />
                  <h2 className="text-lg font-semibold text-white mb-2">Delete Document?</h2>
                  <p className="text-sm text-gray-400 mb-5">
                    This is permanent. The file will be removed from your vault and cannot be recovered.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      disabled={deleting}
                      className="btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="btn-danger flex-1 justify-center"
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        documentIds={[doc.documentId]}
        documentLabels={[doc.title || doc.originalFilename]}
      />
    </div>
  );
}
