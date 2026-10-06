import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { FolderListItem, MemoryDocumentListItem } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MemoryDocumentView } from "@/components/memory/MemoryDocumentView";
import { MemoryTree } from "@/components/memory/MemoryTree";
import { buildMemoryTree } from "@/components/memory/memory-tree";
import { foldersApi } from "../api/folders";
import { memoryDocumentsApi } from "../api/memoryDocuments";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";

const RAIL_STORAGE_KEY = "paperclip.memory.folderRail.width";
const DEFAULT_RAIL_WIDTH = 288;
const MIN_RAIL_WIDTH = 224;
const MAX_RAIL_WIDTH = 400;

function clampRailWidth(width: number) {
  return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, width));
}

function readStoredRailWidth() {
  if (typeof window === "undefined") return DEFAULT_RAIL_WIDTH;
  try {
    const stored = window.localStorage.getItem(RAIL_STORAGE_KEY);
    if (!stored) return DEFAULT_RAIL_WIDTH;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? clampRailWidth(parsed) : DEFAULT_RAIL_WIDTH;
  } catch {
    return DEFAULT_RAIL_WIDTH;
  }
}

function writeStoredRailWidth(width: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, String(clampRailWidth(width)));
  } catch {
    // Resizing still works when browser storage is unavailable.
  }
}

/** One dialog serves create-folder, create-document and both renames. */
type NamePrompt =
  | { kind: "create-folder"; parentId: string | null }
  | { kind: "create-document"; folderId: string | null }
  | { kind: "rename-folder"; folder: FolderListItem }
  | { kind: "rename-document"; document: MemoryDocumentListItem };

type DeletePrompt =
  | { kind: "folder"; folder: FolderListItem }
  | { kind: "document"; document: MemoryDocumentListItem };

const PROMPT_COPY: Record<NamePrompt["kind"], { title: string; action: string; label: string }> = {
  "create-folder": { title: "New folder", action: "Create", label: "Folder name" },
  "create-document": { title: "New document", action: "Create", label: "Document title" },
  "rename-folder": { title: "Rename folder", action: "Rename", label: "Folder name" },
  "rename-document": { title: "Rename document", action: "Rename", label: "Document title" },
};

export function Memory() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedDocumentId = searchParams.get("doc");

  const [railWidth, setRailWidth] = useState(readStoredRailWidth);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [pendingDocumentId, setPendingDocumentId] = useState<string | null>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Memory" }]);
  }, [setBreadcrumbs]);

  const foldersQuery = useQuery({
    queryKey: queryKeys.folders.list(selectedCompanyId!, "memory"),
    queryFn: () => foldersApi.list(selectedCompanyId!, "memory"),
    enabled: !!selectedCompanyId,
  });
  const documentsQuery = useQuery({
    queryKey: queryKeys.memoryDocuments.list(selectedCompanyId!),
    queryFn: () => memoryDocumentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const documentQuery = useQuery({
    queryKey: queryKeys.memoryDocuments.detail(selectedCompanyId!, selectedDocumentId!),
    queryFn: () => memoryDocumentsApi.get(selectedCompanyId!, selectedDocumentId!),
    enabled: !!selectedCompanyId && !!selectedDocumentId,
  });

  const model = useMemo(
    () => buildMemoryTree(foldersQuery.data?.folders ?? [], documentsQuery.data?.documents ?? []),
    [foldersQuery.data, documentsQuery.data],
  );

  function invalidateAll() {
    if (!selectedCompanyId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.folders.list(selectedCompanyId, "memory"),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.memoryDocuments.list(selectedCompanyId),
    });
  }

  function selectDocument(documentId: string | null) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (documentId) next.set("doc", documentId);
        else next.delete("doc");
        return next;
      },
      { replace: true },
    );
  }

  const createFolder = useMutation({
    mutationFn: ({ parentId, name }: { parentId: string | null; name: string }) =>
      foldersApi.create(selectedCompanyId!, { kind: "memory", parentId, name }),
    onSuccess: invalidateAll,
  });
  const createDocument = useMutation({
    mutationFn: ({ folderId, title }: { folderId: string | null; title: string }) =>
      memoryDocumentsApi.create(selectedCompanyId!, { folderId, title }),
    onSuccess: (created) => {
      invalidateAll();
      selectDocument(created.id);
    },
  });
  const renameFolder = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      foldersApi.update(selectedCompanyId!, folderId, { name }),
    onSuccess: invalidateAll,
  });
  const renameDocument = useMutation({
    mutationFn: ({ documentId, title }: { documentId: string; title: string }) =>
      memoryDocumentsApi.update(selectedCompanyId!, documentId, { title }),
    onSuccess: (updated) => {
      invalidateAll();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryDocuments.detail(selectedCompanyId!, updated.id),
      });
    },
  });
  const deleteFolder = useMutation({
    mutationFn: (folderId: string) => foldersApi.delete(selectedCompanyId!, folderId),
    onSuccess: invalidateAll,
  });
  const deleteDocument = useMutation({
    mutationFn: (documentId: string) => memoryDocumentsApi.delete(selectedCompanyId!, documentId),
    onSuccess: (_result, documentId) => {
      invalidateAll();
      if (documentId === selectedDocumentId) selectDocument(null);
    },
  });
  const moveDocument = useMutation({
    mutationFn: ({ documentId, folderId }: { documentId: string; folderId: string | null }) =>
      memoryDocumentsApi.move(selectedCompanyId!, documentId, { folderId }),
    onSuccess: invalidateAll,
  });
  const moveFolder = useMutation({
    mutationFn: ({ folderId, parentId }: { folderId: string; parentId: string | null }) =>
      foldersApi.moveFolder(selectedCompanyId!, folderId, { parentId, position: 0 }),
    onSuccess: invalidateAll,
  });
  const saveDocument = useMutation({
    mutationFn: ({ documentId, markdown }: { documentId: string; markdown: string }) =>
      memoryDocumentsApi.update(selectedCompanyId!, documentId, { markdown }),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        queryKeys.memoryDocuments.detail(selectedCompanyId!, updated.id),
        updated,
      );
      invalidateAll();
    },
  });

  /** Wikilinks resolve against the already-loaded list, so no round-trip is needed. */
  const resolveWikiLinkHref = useCallback(
    (target: string) => {
      const normalized = target.trim().toLowerCase();
      const match = (documentsQuery.data?.documents ?? []).find(
        (document) =>
          document.title.toLowerCase() === normalized || document.slug === normalized,
      );
      return match ? `/memory?doc=${encodeURIComponent(match.id)}` : null;
    },
    [documentsQuery.data],
  );

  function requestDocument(documentId: string) {
    if (draftDirty && documentId !== selectedDocumentId) {
      setPendingDocumentId(documentId);
      return;
    }
    selectDocument(documentId);
  }

  const resolvePendingNavigation = useCallback(
    (discard: boolean) => {
      if (discard && pendingDocumentId) selectDocument(pendingDocumentId);
      setPendingDocumentId(null);
    },
    // selectDocument is stable enough for this guard; the id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingDocumentId],
  );

  function submitPrompt() {
    const value = promptValue.trim();
    if (!namePrompt || value.length === 0) return;
    if (namePrompt.kind === "create-folder") {
      createFolder.mutate({ parentId: namePrompt.parentId, name: value });
    } else if (namePrompt.kind === "create-document") {
      createDocument.mutate({ folderId: namePrompt.folderId, title: value });
    } else if (namePrompt.kind === "rename-folder") {
      renameFolder.mutate({ folderId: namePrompt.folder.id, name: value });
    } else {
      renameDocument.mutate({ documentId: namePrompt.document.id, title: value });
    }
    setNamePrompt(null);
    setPromptValue("");
  }

  function openPrompt(prompt: NamePrompt) {
    setNamePrompt(prompt);
    setPromptValue(
      prompt.kind === "rename-folder"
        ? prompt.folder.name
        : prompt.kind === "rename-document"
          ? prompt.document.title
          : "",
    );
  }

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (!resizeStart.current) return;
      const next = clampRailWidth(
        resizeStart.current.width + (event.clientX - resizeStart.current.x),
      );
      setRailWidth(next);
    }
    function onPointerUp() {
      if (!resizeStart.current) return;
      resizeStart.current = null;
      setRailWidth((current) => {
        writeStoredRailWidth(current);
        return current;
      });
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a workspace to open Memory.</p>;
  }

  const loading = foldersQuery.isLoading || documentsQuery.isLoading;
  const deleteCounts =
    deletePrompt?.kind === "folder"
      ? {
          documents: (documentsQuery.data?.documents ?? []).filter(
            (document) => document.folderId === deletePrompt.folder.id,
          ).length,
        }
      : null;

  return (
    <div className="flex h-(--tc-thread-max-h) min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
      <aside
        className="flex min-h-0 shrink-0 flex-col border-r border-border py-2"
        style={{ width: railWidth }}
        data-testid="memory-rail"
      >
        <h2 className="px-3 pb-2 text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
          Knowledge base
        </h2>
        {loading ? (
          <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : (
          <MemoryTree
            model={model}
            selectedDocumentId={selectedDocumentId}
            onSelectDocument={requestDocument}
            onCreateFolder={(parentId) => openPrompt({ kind: "create-folder", parentId })}
            onCreateDocument={(folderId) => openPrompt({ kind: "create-document", folderId })}
            onRenameFolder={(folder) => openPrompt({ kind: "rename-folder", folder })}
            onDeleteFolder={(folder) => setDeletePrompt({ kind: "folder", folder })}
            onRenameDocument={(document) => openPrompt({ kind: "rename-document", document })}
            onDeleteDocument={(document) => setDeletePrompt({ kind: "document", document })}
            onMoveDocument={(documentId, folderId) => moveDocument.mutate({ documentId, folderId })}
            onMoveFolder={(folderId, parentId) => moveFolder.mutate({ folderId, parentId })}
          />
        )}
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize rail"
        className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border"
        onPointerDown={(event) => {
          resizeStart.current = { x: event.clientX, width: railWidth };
        }}
      />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!selectedDocumentId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              Select a document from the rail, or create one to start.
            </p>
            <Button size="sm" onClick={() => openPrompt({ kind: "create-document", folderId: null })}>
              New document
            </Button>
          </div>
        ) : documentQuery.isLoading || !documentQuery.data ? (
          <p className="flex items-center gap-2 px-6 py-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading document…
          </p>
        ) : (
          <MemoryDocumentView
            document={documentQuery.data}
            saving={saveDocument.isPending}
            onSave={async (markdown) => {
              await saveDocument.mutateAsync({ documentId: documentQuery.data.id, markdown });
            }}
            resolveWikiLinkHref={resolveWikiLinkHref}
            pendingNavigation={pendingDocumentId ? () => selectDocument(pendingDocumentId) : null}
            onResolvePendingNavigation={resolvePendingNavigation}
            onDirtyChange={setDraftDirty}
          />
        )}
        </section>
      </div>

      <Dialog
        open={namePrompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            setNamePrompt(null);
            setPromptValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{namePrompt ? PROMPT_COPY[namePrompt.kind].title : ""}</DialogTitle>
            <DialogDescription>
              {namePrompt ? PROMPT_COPY[namePrompt.kind].label : ""}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitPrompt();
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNamePrompt(null)}>
              Cancel
            </Button>
            <Button onClick={submitPrompt} disabled={promptValue.trim().length === 0}>
              {namePrompt ? PROMPT_COPY[namePrompt.kind].action : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletePrompt !== null} onOpenChange={(open) => !open && setDeletePrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deletePrompt?.kind === "folder" ? "Delete folder?" : "Delete document?"}
            </DialogTitle>
            <DialogDescription>
              {deletePrompt?.kind === "folder"
                ? `"${deletePrompt.folder.name}" will be removed. ${
                    deleteCounts?.documents
                      ? `Its ${deleteCounts.documents} document(s) are kept and moved out of any folder.`
                      : "It has no documents of its own."
                  }`
                : deletePrompt
                  ? `"${deletePrompt.document.title}" will be permanently deleted. This cannot be undone.`
                  : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeletePrompt(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deletePrompt) return;
                if (deletePrompt.kind === "folder") deleteFolder.mutate(deletePrompt.folder.id);
                else deleteDocument.mutate(deletePrompt.document.id);
                setDeletePrompt(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Memory;
