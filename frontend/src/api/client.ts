import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { fetchAuthSession } from "aws-amplify/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Document {
  documentId: string;
  ownerId: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  status: "PENDING_UPLOAD" | "PROCESSING" | "READY" | "FAILED";
  documentType:
    | "RECEIPT"
    | "INVOICE"
    | "PASSPORT"
    | "ID_CARD"
    | "INSURANCE"
    | "WARRANTY"
    | "CONTRACT"
    | "MEDICAL"
    | "BANK"
    | "OTHER";
  category: string;
  title?: string;
  summary?: string;
  viewUrl?: string;
  // Receipt fields
  merchant?: string;
  purchaseDate?: string;
  productName?: string;
  amount?: number;
  currency?: string;
  invoiceNumber?: string;
  receiptNumber?: string;
  serialNumber?: string;
  warrantyPeriod?: string;
  warrantyStartDate?: string;
  warrantyEndDate?: string;
  warrantyStatus?: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NO_WARRANTY";
  warrantyDaysRemaining?: number;
  returnPeriod?: string;
  returnDeadline?: string;
  returnDaysRemaining?: number;
  seller?: string;
  paymentMethod?: string;
  // General doc fields
  issuer?: string;
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  expiryDaysRemaining?: number;
  personName?: string;
  organization?: string;
  importantDates?: Array<{ date: string; description: string }>;
  importantAmounts?: Array<{ amount: number; description: string }>;
  entities?: string[];
  keywords?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Share {
  shareId: string;
  ownerId: string;
  documents: Array<{ documentId: string; title: string; s3Key: string }>;
  documentIds: string[];
  createdAt: string;
  expiresAt: string;
  expiresIn: "1h" | "24h" | "7d";
  maxDownloads?: number;
  downloadCount: number;
  revoked: boolean;
  recipientLabel?: string;
  shareUrl?: string;
}

export interface DashboardData {
  stats: {
    totalDocuments: number;
    totalReceipts: number;
    totalAll: number;
    processingCount: number;
    activeWarranties: number;
    expiringSoon: number;
    expiredWarranties: number;
    attentionRequired: number;
  };
  recentDocuments: Document[];
  recentReceipts: Document[];
  attentionItems: AttentionItem[];
  expiringSoonWarranties: WarrantyItem[];
}

export interface AttentionItem {
  documentId: string;
  title: string;
  type: string;
  daysRemaining: number;
  reason: string;
}

export interface WarrantyItem {
  documentId: string;
  title: string;
  merchant?: string;
  purchaseDate?: string;
  warrantyEndDate: string;
  daysRemaining: number;
  serialNumber?: string;
  warrantyStatus: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";
}

export interface WarrantyData {
  stats: { active: number; expiringSoon: number; expired: number };
  active: WarrantyItem[];
  expiringSoon: WarrantyItem[];
  expired: WarrantyItem[];
}

export interface VaultQueryResult {
  question: string;
  answer: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  additionalInfo?: string;
  documents: Document[];
}

export interface SuggestPackageResult {
  purpose: string;
  packageName: string;
  suggestedDocuments: Document[];
  /** Backend returns "advice" — aliased here for compatibility */
  advice?: string;
  reasoning?: string;
  /** Backend returns "missingDocumentTypes" — aliased here */
  missingDocumentTypes?: string[];
  missingDocuments?: string[];
}

export interface AuditEvent {
  eventId: string;
  action: string;
  documentId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface UploadUrlResponse {
  documentId: string;
  uploadUrl: string;
  s3Key: string;
}

export interface PublicShareAccess {
  shareId: string;
  documents: Array<{ title: string; documentId: string }>;
  expiresAt: string;
  recipientLabel?: string;
  downloadCount: number;
  maxDownloads?: number;
}

// ─── Axios instance ───────────────────────────────────────────────────────────

const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL as string,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

// Inject Cognito JWT on every authenticated request
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // If session fetch fails, proceed without auth (public routes)
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── API helpers ──────────────────────────────────────────────────────────────

export const api = {
  // Dashboard
  getDashboard: () =>
    apiClient.get<DashboardData>("/dashboard").then((r) => r.data),

  // Documents
  listDocuments: (params?: {
    category?: string;
    type?: string;
    status?: string;
  }) =>
    apiClient
      .get<{ documents: Document[]; count: number }>("/documents", { params })
      .then((r) => r.data),

  getDocument: (id: string) =>
    apiClient.get<Document>(`/documents/${id}`).then((r) => r.data),

  getUploadUrl: (payload: {
    filename: string;
    contentType: string;
    fileSize: number;
  }) =>
    apiClient
      .post<UploadUrlResponse>("/documents/upload-url", payload)
      .then((r) => r.data),

  confirmUpload: (documentId: string) =>
    apiClient
      .post<Document>("/documents/confirm-upload", { documentId })
      .then((r) => r.data),

  updateDocument: (id: string, updates: Partial<Document>) =>
    apiClient.patch<Document>(`/documents/${id}`, updates).then((r) => r.data),

  deleteDocument: (id: string) =>
    apiClient
      .delete<{ message: string; documentId: string }>(`/documents/${id}`)
      .then((r) => r.data),

  getDownloadUrl: (id: string) =>
    apiClient
      .get<{ downloadUrl: string; filename: string }>(`/documents/${id}/download`)
      .then((r) => r.data),

  getAuditHistory: (id: string) =>
    apiClient
      .get<{ events: AuditEvent[] }>(`/documents/${id}/audit`)
      .then((r) => r.data),

  // Receipts
  listReceipts: (params?: {
    merchant?: string;
    category?: string;
    minAmount?: number;
    maxAmount?: number;
    warrantyStatus?: string;
  }) =>
    apiClient
      .get<{ receipts: Document[]; count: number }>("/receipts", { params })
      .then((r) => r.data),

  // Warranties
  getWarranties: () =>
    apiClient.get<WarrantyData>("/warranties").then((r) => r.data),

  getExpiringWarranties: (days: number) =>
    apiClient
      .get<{ items: WarrantyItem[]; count: number; days: number }>(
        `/warranties/expiring`,
        { params: { days } }
      )
      .then((r) => r.data),

  // Shares
  listShares: () =>
    apiClient
      .get<{ shares: Share[]; count: number }>("/shares")
      .then((r) => r.data),

  createShare: (payload: {
    documentIds: string[];
    expiresIn: string;
    maxDownloads?: number;
    recipientLabel?: string;
  }) => apiClient.post<Share>("/shares", payload).then((r) => r.data),

  revokeShare: (id: string) =>
    apiClient
      .post<{ message: string; shareId: string }>(`/shares/${id}/revoke`)
      .then((r) => r.data),

  // Public share (no auth)
  accessShare: (shareId: string) =>
    axios
      .get<PublicShareAccess>(
        `${import.meta.env.VITE_API_URL}/shares/${shareId}/access`
      )
      .then((r) => r.data),

  downloadShareDoc: (shareId: string, docIndex: number) =>
    axios
      .get<{ downloadUrl: string }>(
        `${import.meta.env.VITE_API_URL}/shares/${shareId}/download`,
        { params: { doc: docIndex } }
      )
      .then((r) => r.data),

  // Vault AI
  queryVault: (question: string) =>
    apiClient
      .post<VaultQueryResult>("/vault/query", { question })
      .then((r) => r.data),

  suggestPackage: (purpose: string) =>
    apiClient
      .post<SuggestPackageResult>("/vault/suggest-package", { purpose })
      .then((r) => r.data),
};

export default apiClient;
