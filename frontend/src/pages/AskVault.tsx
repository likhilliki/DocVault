import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Bot,
  User,
  Package,
  AlertTriangle,
  CheckSquare,
  Square,
  Sparkles,
  Loader2,
} from "lucide-react";
import {
  api,
  type Document,
  type VaultQueryResult,
  type SuggestPackageResult,
} from "../api/client";
import ShareModal from "../components/ShareModal";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  documents?: Document[];
  timestamp: Date;
}

type Tab = "chat" | "package";

export default function AskVault() {
  const [tab, setTab] = useState<Tab>("chat");

  /* ── Chat state ─────────────────────────────────────────────── */
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Ask me anything about your documents — warranties, receipts, expiry dates, or find specific files.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ── Package state ──────────────────────────────────────────── */
  const [purpose, setPurpose] = useState("");
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageResult, setPackageResult] = useState<SuggestPackageResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  /* ── Helpers ────────────────────────────────────────────────── */
  const scrollToBottom = () =>
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || chatLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setChatLoading(true);
    scrollToBottom();

    try {
      const result: VaultQueryResult = await api.queryVault(question);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: result.answer,
          confidence: result.confidence,
          documents: result.documents,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content:
            err instanceof Error
              ? err.message
              : "Sorry, I couldn't process that question. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setChatLoading(false);
      scrollToBottom();
    }
  };

  const handleSuggestPackage = async () => {
    const p = purpose.trim();
    if (!p || packageLoading) return;

    setPackageLoading(true);
    setPackageError(null);
    setPackageResult(null);
    setSelectedIds(new Set());

    try {
      const result = await api.suggestPackage(p);
      setPackageResult(result);
      // Auto-select all suggested docs
      const ids = new Set(
        (result.suggestedDocuments ?? []).map((d) => d.documentId)
      );
      setSelectedIds(ids);
    } catch (err) {
      setPackageError(
        err instanceof Error ? err.message : "Failed to suggest package. Please try again."
      );
    } finally {
      setPackageLoading(false);
    }
  };

  const toggleDoc = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedDocs = (packageResult?.suggestedDocuments ?? []).filter((d) =>
    selectedIds.has(d.documentId)
  );

  const confidenceBadge = (c?: "HIGH" | "MEDIUM" | "LOW") => {
    if (!c) return null;
    const map = { HIGH: "badge-green", MEDIUM: "badge-orange", LOW: "badge-red" };
    return <span className={map[c]}>{c} confidence</span>;
  };

  // Derive the best description / missing list regardless of field name
  const packageDescription =
    packageResult?.advice || packageResult?.reasoning || "";
  const missingList =
    packageResult?.missingDocumentTypes ?? packageResult?.missingDocuments ?? [];

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border mb-4 w-fit flex-shrink-0">
        <button
          onClick={() => setTab("chat")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            tab === "chat"
              ? "bg-primary-500/10 text-primary-400"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Bot size={14} />
          Ask Vault
        </button>
        <button
          onClick={() => setTab("package")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            tab === "package"
              ? "bg-primary-500/10 text-primary-400"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Package size={14} />
          Create Package
        </button>
      </div>

      {/* ── Chat tab ─────────────────────────────────────────────── */}
      {tab === "chat" && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Message list */}
          <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      msg.role === "user"
                        ? "bg-primary-500/20"
                        : "bg-surface-2 border border-border"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <User size={15} className="text-primary-400" />
                    ) : (
                      <Sparkles size={15} className="text-primary-400" />
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-primary-500/10 border border-primary-500/20"
                        : "glass-card"
                    }`}
                  >
                    <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                    {msg.confidence && (
                      <div className="mt-2">{confidenceBadge(msg.confidence)}</div>
                    )}
                    {msg.documents && msg.documents.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border space-y-1">
                        <p className="text-xs text-gray-500 mb-1.5">
                          Related documents:
                        </p>
                        {msg.documents.map((d) => (
                          <Link
                            key={d.documentId}
                            to={`/documents/${d.documentId}`}
                            className="block text-xs text-primary-400 hover:text-primary-300 truncate"
                          >
                            → {d.title || d.originalFilename}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {chatLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center">
                  <Sparkles size={15} className="text-primary-400" />
                </div>
                <div className="glass-card px-4 py-3 flex items-center gap-2">
                  <Loader2 size={15} className="text-primary-400 animate-spin" />
                  <span className="text-xs text-gray-400">Searching your vault…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="flex gap-2 flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
              placeholder="e.g. Which warranties expire this month?"
              className="input-field flex-1"
              disabled={chatLoading}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || chatLoading}
              className="btn-primary disabled:opacity-50"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Package tab ───────────────────────────────────────────── */}
      {tab === "package" && (
        <div className="space-y-4 overflow-y-auto flex-1">
          {/* Prompt card */}
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-white mb-1">
              Create Document Package
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Describe why you need documents (e.g. "internship onboarding",
              "apartment lease", "travel visa"). Vault AI will suggest the
              relevant files from your vault for you to review.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !packageLoading && void handleSuggestPackage()
                }
                placeholder="What's the purpose of this package?"
                className="input-field flex-1"
                disabled={packageLoading}
              />
              <button
                onClick={() => void handleSuggestPackage()}
                disabled={!purpose.trim() || packageLoading}
                className="btn-primary disabled:opacity-50 flex-shrink-0"
              >
                {packageLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Suggest
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {packageError && (
            <div className="glass-card p-4 flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{packageError}</p>
            </div>
          )}

          {/* Results */}
          {packageResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Package summary */}
              <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-white mb-1">
                  {packageResult.packageName || purpose}
                </h3>
                {packageDescription && (
                  <p className="text-xs text-gray-400">{packageDescription}</p>
                )}
              </div>

              {/* Missing docs warning */}
              {missingList.length > 0 && (
                <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      size={16}
                      className="text-orange-400 flex-shrink-0 mt-0.5"
                    />
                    <div>
                      <p className="text-xs font-medium text-orange-300 mb-1">
                        Potentially missing documents
                      </p>
                      <ul className="text-xs text-gray-400 space-y-0.5">
                        {missingList.map((m, i) => (
                          <li key={i}>• {m}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Document checklist */}
              {packageResult.suggestedDocuments.length === 0 ? (
                <div className="glass-card p-5 text-center">
                  <p className="text-sm text-gray-400">
                    No matching documents found in your vault for this purpose.
                    Try uploading relevant documents first.
                  </p>
                </div>
              ) : (
                <div className="glass-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                    <p className="text-xs text-gray-400">
                      Select documents to include
                    </p>
                    <span className="badge-indigo">{selectedIds.size} selected</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {packageResult.suggestedDocuments.map((doc) => {
                      const checked = selectedIds.has(doc.documentId);
                      return (
                        <li key={doc.documentId}>
                          <button
                            onClick={() => toggleDoc(doc.documentId)}
                            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition-colors text-left"
                          >
                            {checked ? (
                              <CheckSquare
                                size={18}
                                className="text-primary-400 flex-shrink-0"
                              />
                            ) : (
                              <Square
                                size={18}
                                className="text-gray-600 flex-shrink-0"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white truncate">
                                {doc.title || doc.originalFilename}
                              </p>
                              <p className="text-xs text-gray-500">
                                {doc.documentType?.replace(/_/g, " ")}
                              </p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Human-approval warning */}
              <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={16}
                    className="text-orange-400 flex-shrink-0 mt-0.5"
                  />
                  <p className="text-xs text-gray-400">
                    Sharing requires your explicit approval. You'll review the
                    document selection and settings before any link is created.
                  </p>
                </div>
              </div>

              {/* CTA */}
              <button
                onClick={() => setShareOpen(true)}
                disabled={selectedIds.size === 0}
                className="btn-primary w-full justify-center disabled:opacity-50"
              >
                <Package size={15} />
                Review &amp; Create Share Link ({selectedIds.size} doc
                {selectedIds.size !== 1 ? "s" : ""})
              </button>
            </motion.div>
          )}
        </div>
      )}

      {/* Share modal */}
      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        documentIds={Array.from(selectedIds)}
        documentLabels={selectedDocs.map(
          (d) => d.title || d.originalFilename
        )}
        title="Share Document Package"
        onSuccess={() => setShareOpen(false)}
      />
    </div>
  );
}
