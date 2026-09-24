import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Vault,
  Download,
  Clock,
  FileText,
  AlertTriangle,
  Shield,
} from "lucide-react";
import { api, type PublicShareAccess } from "../api/client";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatDateTime } from "../utils/format";

export default function PublicShare() {
  const { shareId } = useParams<{ shareId: string }>();
  const [data, setData] = useState<PublicShareAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!shareId) {
      setError("Invalid share link");
      setLoading(false);
      return;
    }

    api
      .accessShare(shareId)
      .then(setData)
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "This share link is invalid, expired, or has been revoked."
        );
      })
      .finally(() => setLoading(false));
  }, [shareId]);

  const handleDownload = async (docIndex: number) => {
    if (!shareId) return;
    setDownloadingIndex(docIndex);
    try {
      const { downloadUrl } = await api.downloadShareDoc(shareId, docIndex);
      window.open(downloadUrl, "_blank");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Download failed. The link may have expired."
      );
    } finally {
      setDownloadingIndex(null);
    }
  };

  const isExpired = data ? new Date(data.expiresAt) < new Date() : false;
  const downloadsExhausted =
    data?.maxDownloads != null && data.downloadCount >= data.maxDownloads;

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-surface px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-9 h-9 bg-primary-500 rounded-xl flex items-center justify-center">
            <Vault size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">DocVault</p>
            <p className="text-xs text-gray-500">Secure document share</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center p-4 pt-10">
        <div className="w-full max-w-lg">
          {loading ? (
            <LoadingSpinner fullPage label="Loading shared documents…" />
          ) : error ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-8 text-center"
            >
              <AlertTriangle size={32} className="text-red-400 mx-auto mb-4" />
              <h1 className="text-lg font-semibold text-white mb-2">
                Unable to Access
              </h1>
              <p className="text-sm text-gray-400">{error}</p>
            </motion.div>
          ) : data ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Shield size={16} className="text-primary-400" />
                  <h1 className="text-lg font-semibold text-white">
                    Shared Documents
                  </h1>
                </div>
                {data.recipientLabel && (
                  <p className="text-sm text-gray-400 mb-3">
                    Prepared for: {data.recipientLabel}
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {isExpired ? "Expired" : `Expires ${formatDateTime(data.expiresAt)}`}
                  </span>
                  <span className="flex items-center gap-1">
                    <Download size={12} />
                    {data.downloadCount}
                    {data.maxDownloads != null ? ` / ${data.maxDownloads}` : ""} downloads
                  </span>
                </div>
              </div>

              {(isExpired || downloadsExhausted) && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">
                    {isExpired
                      ? "This share link has expired."
                      : "Download limit reached for this share link."}
                  </p>
                </div>
              )}

              <div className="glass-card overflow-hidden">
                <ul className="divide-y divide-border">
                  {data.documents.map((doc, index) => (
                    <li
                      key={doc.documentId || index}
                      className="flex items-center gap-3 px-5 py-4"
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary-500/10 flex items-center justify-center flex-shrink-0">
                        <FileText size={16} className="text-primary-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {doc.title}
                        </p>
                      </div>
                      <button
                        onClick={() => void handleDownload(index)}
                        disabled={
                          isExpired ||
                          downloadsExhausted ||
                          downloadingIndex === index
                        }
                        className="btn-primary py-1.5 px-3 text-xs disabled:opacity-50"
                      >
                        <Download size={13} />
                        {downloadingIndex === index ? "…" : "Download"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-gray-600 text-center px-4">
                Documents shared via DocVault are encrypted and access is time-limited.
                Do not forward this link to unauthorized parties.
              </p>
            </motion.div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
