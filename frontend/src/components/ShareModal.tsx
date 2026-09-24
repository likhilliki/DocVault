import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Share2, Copy, Check, AlertTriangle, CheckSquare, Square } from "lucide-react";
import { api, type Document, type Share } from "../api/client";
import LoadingSpinner from "./LoadingSpinner";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  documentIds: string[];
  documentLabels?: string[];
  onSuccess?: (share: Share) => void;
  title?: string;
  allowDocumentSelection?: boolean;
}

const EXPIRY_OPTIONS = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
] as const;

export default function ShareModal({
  open,
  onClose,
  documentIds,
  documentLabels,
  onSuccess,
  title = "Create Secure Share",
  allowDocumentSelection = false,
}: ShareModalProps) {
  const [expiresIn, setExpiresIn] = useState<"1h" | "24h" | "7d">("24h");
  const [maxDownloads, setMaxDownloads] = useState<string>("");
  const [recipientLabel, setRecipientLabel] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdShare, setCreatedShare] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);
  const [availableDocs, setAvailableDocs] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(documentIds));

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(documentIds));
    }
  }, [open, documentIds]);

  useEffect(() => {
    if (!open || !allowDocumentSelection || documentIds.length > 0) return;
    setDocsLoading(true);
    api
      .listDocuments({ status: "READY" })
      .then((result) => setAvailableDocs(result.documents ?? []))
      .catch(() => setAvailableDocs([]))
      .finally(() => setDocsLoading(false));
  }, [open, allowDocumentSelection, documentIds.length]);

  const effectiveIds =
    documentIds.length > 0 ? documentIds : Array.from(selectedIds);

  const effectiveLabels =
    documentLabels && documentLabels.length > 0
      ? documentLabels
      : availableDocs
          .filter((d) => selectedIds.has(d.documentId))
          .map((d) => d.title || d.originalFilename);

  const toggleDoc = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setExpiresIn("24h");
    setMaxDownloads("");
    setRecipientLabel("");
    setConfirmed(false);
    setLoading(false);
    setError(null);
    setCreatedShare(null);
    setCopied(false);
    setSelectedIds(new Set(documentIds));
    setAvailableDocs([]);
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const shareUrl = createdShare
    ? `${window.location.origin}/s/${createdShare.shareId}`
    : "";

  const handleCreate = async () => {
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    try {
      const share = await api.createShare({
        documentIds: effectiveIds,
        expiresIn,
        maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : undefined,
        recipientLabel: recipientLabel.trim() || undefined,
      });
      setCreatedShare(share);
      onSuccess?.(share);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={handleClose}
          />

          {/* Scroll container — fills viewport, centers content */}
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-6 sm:py-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="glass-card p-6 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Share2 size={18} className="text-primary-400" />
                    <h2 className="text-lg font-semibold text-white">{title}</h2>
                  </div>
                  <button onClick={handleClose} className="btn-ghost p-1.5">
                    <X size={18} />
                  </button>
                </div>

                {createdShare ? (
                  /* Success state */
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-sm text-emerald-300 font-medium mb-1">
                        Share link created
                      </p>
                      <p className="text-xs text-gray-400">
                        Anyone with this link can download the shared documents
                        until expiry.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={shareUrl}
                        className="input-field flex-1 text-xs font-mono"
                      />
                      <button
                        onClick={handleCopy}
                        className="btn-primary flex-shrink-0"
                      >
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <button onClick={handleClose} className="btn-secondary w-full">
                      Done
                    </button>
                  </div>
                ) : (
                  /* Create state */
                  <div className="space-y-4">
                    {/* Document list */}
                    {allowDocumentSelection && documentIds.length === 0 ? (
                      <div className="rounded-lg bg-surface-2 border border-border overflow-hidden max-h-40 overflow-y-auto">
                        {docsLoading ? (
                          <div className="p-4">
                            <LoadingSpinner size={18} label="Loading documents…" />
                          </div>
                        ) : availableDocs.length === 0 ? (
                          <p className="p-4 text-xs text-gray-500">
                            No ready documents available to share.
                          </p>
                        ) : (
                          <ul className="divide-y divide-border">
                            {availableDocs.map((doc) => {
                              const checked = selectedIds.has(doc.documentId);
                              return (
                                <li key={doc.documentId}>
                                  <button
                                    type="button"
                                    onClick={() => toggleDoc(doc.documentId)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface transition-colors text-left"
                                  >
                                    {checked ? (
                                      <CheckSquare size={16} className="text-primary-400 flex-shrink-0" />
                                    ) : (
                                      <Square size={16} className="text-gray-600 flex-shrink-0" />
                                    )}
                                    <span className="text-sm text-gray-300 truncate">
                                      {doc.title || doc.originalFilename}
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-surface-2 border border-border">
                        <p className="text-xs text-gray-500 mb-2">
                          {effectiveIds.length} document
                          {effectiveIds.length !== 1 ? "s" : ""} selected
                        </p>
                        {effectiveLabels.length > 0 && (
                          <ul className="space-y-1">
                            {effectiveLabels.map((label, i) => (
                              <li key={i} className="text-sm text-gray-300 truncate">
                                • {label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Expiry */}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">
                        Expires in
                      </label>
                      <select
                        value={expiresIn}
                        onChange={(e) =>
                          setExpiresIn(e.target.value as "1h" | "24h" | "7d")
                        }
                        className="select-field w-full"
                      >
                        {EXPIRY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Max downloads */}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">
                        Max downloads (optional)
                      </label>
                      <input
                        type="number"
                        min="1"
                        placeholder="Unlimited"
                        value={maxDownloads}
                        onChange={(e) => setMaxDownloads(e.target.value)}
                        className="input-field"
                      />
                    </div>

                    {/* Recipient label */}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">
                        Recipient label (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Landlord, Insurance claim"
                        value={recipientLabel}
                        onChange={(e) => setRecipientLabel(e.target.value)}
                        className="input-field"
                      />
                    </div>

                    {/* Confirmation */}
                    <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          size={16}
                          className="text-orange-400 flex-shrink-0 mt-0.5"
                        />
                        <div>
                          <p className="text-xs font-medium text-orange-300 mb-1">
                            Human approval required
                          </p>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={confirmed}
                              onChange={(e) => setConfirmed(e.target.checked)}
                              className="mt-0.5 accent-primary-500"
                            />
                            <span className="text-xs text-gray-400">
                              I confirm I want to share these documents.
                              Recipients will be able to download them via a
                              public link.
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {error && <p className="text-xs text-red-400">{error}</p>}

                    <div className="flex gap-3 pt-1">
                      <button
                        onClick={handleClose}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreate}
                        disabled={
                          !confirmed || loading || effectiveIds.length === 0
                        }
                        className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed justify-center"
                      >
                        {loading ? "Creating…" : "Create Share Link"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
