export interface MemoryDocument {
  id: string;
  companyId: string;
  folderId: string | null;
  title: string;
  slug: string;
  markdown: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Rail listings carry every document, so the body is omitted until one is opened. */
export type MemoryDocumentListItem = Omit<MemoryDocument, "markdown">;

export interface MemoryDocumentListResult {
  documents: MemoryDocumentListItem[];
  allCount: number;
  unfiledCount: number;
}

export interface CreateMemoryDocumentRequest {
  folderId?: string | null;
  title: string;
  slug?: string | null;
  markdown?: string;
}

export interface UpdateMemoryDocumentRequest {
  title?: string;
  markdown?: string;
}

export interface MoveMemoryDocumentRequest {
  folderId?: string | null;
}
