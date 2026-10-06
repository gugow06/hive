import type {
  CreateMemoryDocumentRequest,
  MemoryDocument,
  MemoryDocumentListResult,
  MoveMemoryDocumentRequest,
  UpdateMemoryDocumentRequest,
} from "@paperclipai/shared";
import { api } from "./client";

const base = (companyId: string) =>
  `/companies/${encodeURIComponent(companyId)}/memory-documents`;

export const memoryDocumentsApi = {
  list: (companyId: string) => api.get<MemoryDocumentListResult>(base(companyId)),
  get: (companyId: string, documentId: string) =>
    api.get<MemoryDocument>(`${base(companyId)}/${encodeURIComponent(documentId)}`),
  resolve: (companyId: string, target: string) =>
    api.get<{ document: MemoryDocument | null }>(
      `${base(companyId)}/resolve?target=${encodeURIComponent(target)}`,
    ),
  create: (companyId: string, payload: CreateMemoryDocumentRequest) =>
    api.post<MemoryDocument>(base(companyId), payload),
  update: (companyId: string, documentId: string, payload: UpdateMemoryDocumentRequest) =>
    api.patch<MemoryDocument>(
      `${base(companyId)}/${encodeURIComponent(documentId)}`,
      payload,
    ),
  move: (companyId: string, documentId: string, payload: MoveMemoryDocumentRequest) =>
    api.post<MemoryDocument>(
      `${base(companyId)}/${encodeURIComponent(documentId)}/move`,
      payload,
    ),
  delete: (companyId: string, documentId: string) =>
    api.delete<{ deleted: MemoryDocument }>(
      `${base(companyId)}/${encodeURIComponent(documentId)}`,
    ),
};
