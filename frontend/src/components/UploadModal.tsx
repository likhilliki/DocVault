import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, FileUp, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "../api/client";

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (documentId: string) => void;
}

type UploadPhase = "idle" | "uploading" | "confirming" | "done" | "error";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export default function UploadModal({ open, onClose, onSuccess }: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setFileName(null);
    setProgress(0);
  }, []);

  const handleClose = () => {
    if (phase === "uploading" || phase === "confirming") return;
    reset();
    onClose();
  };

  const uploadFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.type.startsWith("image/")) {
      setError("Unsupported file type. Please upload PDF or image files.");
      setPhase("error");
      return;
    }

    setFileName(file.name);
    setPhase("uploading");
    setError(null);
    setProgress(10);

    try {
      const { documentId, uploadUrl } = await api.getUploadUrl({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        fileSize: file.size,
      });

      setProgress(30);

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          // Only Content-Type — do NOT add x-amz-server-side-encryption here.
          // That header must be part of the presigned URL signature on the backend.
          // Adding unsigned headers to a presigned PUT causes a 403 SignatureDoesNotMatch.
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(`S3 upload failed (${uploadResponse.status})`);
      }

      setProgress(70);
      setPhase("confirming");

      // S3 event automatically triggers the processor Lambda.
      // confirmUpload is a no-op fallback kept for compatibility.
      try { await api.confirmUpload(documentId); } catch { /* optional */ }

      setProgress(100);
      setPhase("done");
      onSuccess?.(documentId);

      setTimeout(() => {
        reset();
        onClose();
      }, 1200);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void uploadFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
    e.target.value = "";
  };

  const isActive = phase === "uploading" || phase === "confirming";

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

          {/* Scroll container — same pattern as ShareModal */}
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
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold text-white">Upload Document</h2>
                  <button
                    onClick={handleClose}
                    disabled={isActive}
                    className="btn-ghost p-1.5 disabled:opacity-40"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Drop zone (idle / error) */}
                {(phase === "idle" || phase === "error") ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200 ${
                      dragOver
                        ? "border-primary-500 bg-primary-500/5"
                        : "border-border hover:border-primary-500/50 hover:bg-surface-2"
                    }`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
                      <Upload size={22} className="text-primary-400" />
                    </div>
                    <p className="text-sm font-medium text-white mb-1">
                      Drop your file here or click to browse
                    </p>
                    <p className="text-xs text-gray-500">
                      PDF, JPEG, PNG, WebP — encrypted at rest
                    </p>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,image/*,application/pdf"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>
                ) : (
                  /* Progress state */
                  <div className="py-6 text-center">
                    <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
                      {phase === "done" ? (
                        <CheckCircle2 size={22} className="text-emerald-400" />
                      ) : (
                        <FileUp size={22} className="text-primary-400 animate-pulse" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-white mb-1 truncate px-4">
                      {fileName}
                    </p>
                    <p className="text-xs text-gray-400 mb-4">
                      {phase === "uploading" && "Uploading to secure storage…"}
                      {phase === "confirming" && "Starting AI processing…"}
                      {phase === "done" && "Upload complete!"}
                    </p>
                    {phase !== "done" && (
                      <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary-500 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Error banner */}
                {error && (
                  <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{error}</p>
                  </div>
                )}

                {phase === "error" && (
                  <button onClick={reset} className="btn-secondary w-full mt-4">
                    Try Again
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
