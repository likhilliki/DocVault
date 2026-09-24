import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Share2,
  Copy,
  Check,
  Ban,
  Clock,
  Download,
  Plus,
  ExternalLink,
} from "lucide-react";
import { api, type Share } from "../api/client";
import LoadingSpinner from "../components/LoadingSpinner";
import EmptyState from "../components/EmptyState";
import StatusBadge from "../components/StatusBadge";
import ShareModal from "../components/ShareModal";
import { formatDateTime, formatRelative } from "../utils/format";

function getShareStatus(share: Share): "REVOKED" | "EXPIRED_SHARE" | "ACTIVE_SHARE" {
  if (share.revoked) return "REVOKED";
  if (new Date(share.expiresAt) < new Date()) return "EXPIRED_SHARE";
  return "ACTIVE_SHARE";
}

function getShareUrl(share: Share): string {
  return share.shareUrl || `${window.location.origin}/s/${share.shareId}`;
}

export default function Shared() {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    try {
      const result = await api.listShares();
      setShares(result.shares ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchShares();
  }, [fetchShares]);

  const handleCopy = async (share: Share) => {
    await navigator.clipboard.writeText(getShareUrl(share));
    setCopiedId(share.shareId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRevoke = async (shareId: string) => {
    setRevokingId(shareId);
    try {
      await api.revokeShare(shareId);
      await fetchShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-400">
          Manage secure links to share documents with others.
        </p>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">
          <Plus size={15} />
          New Share
        </button>
      </div>

      {loading ? (
        <LoadingSpinner fullPage label="Loading shares…" />
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-300 text-sm">{error}</div>
      ) : shares.length === 0 ? (
        <div className="glass-card">
          <EmptyState
            icon={Share2}
            title="No shared links"
            description="Create a secure, time-limited link to share documents with others."
            action={{ label: "Create Share Link", onClick: () => setCreateOpen(true) }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {shares.map((share, i) => {
            const status = getShareStatus(share);
            const url = getShareUrl(share);
            const isActive = status === "ACTIVE_SHARE";

            return (
              <motion.div
                key={share.shareId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="glass-card p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusBadge status={status} />
                      {share.recipientLabel && (
                        <span className="text-xs text-gray-400">
                          for {share.recipientLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white">
                      {share.documents?.length ?? share.documentIds?.length ?? 0} document
                      {(share.documents?.length ?? share.documentIds?.length ?? 0) !== 1 ? "s" : ""}
                    </p>
                    {share.documents && share.documents.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {share.documents.map((d) => (
                          <li key={d.documentId} className="text-xs text-gray-500 truncate">
                            • {d.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-500 flex-shrink-0">
                    <div className="flex items-center gap-1 justify-end mb-1">
                      <Clock size={12} />
                      Expires {formatRelative(share.expiresAt)}
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <Download size={12} />
                      {share.downloadCount}
                      {share.maxDownloads != null ? ` / ${share.maxDownloads}` : ""} downloads
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-2 border border-border mb-3">
                  <code className="text-xs text-gray-400 flex-1 truncate font-mono">
                    /s/{share.shareId}
                  </code>
                  <button
                    onClick={() => void handleCopy(share)}
                    className="btn-ghost p-1.5 flex-shrink-0"
                    title="Copy link"
                  >
                    {copiedId === share.shareId ? (
                      <Check size={14} className="text-emerald-400" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                  {isActive && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost p-1.5 flex-shrink-0"
                      title="Open link"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">
                    Created {formatDateTime(share.createdAt)}
                  </span>
                  {isActive && (
                    <button
                      onClick={() => void handleRevoke(share.shareId)}
                      disabled={revokingId === share.shareId}
                      className="btn-danger py-1.5 px-3 text-xs"
                    >
                      <Ban size={13} />
                      {revokingId === share.shareId ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <ShareModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        documentIds={[]}
        allowDocumentSelection
        onSuccess={() => void fetchShares()}
        title="Create Share Link"
      />
    </div>
  );
}
