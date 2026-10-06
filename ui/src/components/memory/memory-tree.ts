import type { FolderListItem, MemoryDocumentListItem } from "@paperclipai/shared";

/**
 * Pure tree helpers for the Memory rail.
 *
 * The server returns folders and documents as two flat lists. Folders carry a
 * `parentId` and a canonical slug `path`; documents carry a nullable `folderId`.
 * Memory has no reserved/system roots (unlike the skill rail), so the model is
 * a plain forest: top-level folders, then documents that belong to no folder.
 */

export interface MemoryFolderNode {
  folder: FolderListItem;
  folders: MemoryFolderNode[];
  documents: MemoryDocumentListItem[];
}

export interface MemoryTreeModel {
  /** Top-level folders, ordered by position then name. */
  folders: MemoryFolderNode[];
  /** Documents with `folderId === null`, shown at the root of the rail. */
  documents: MemoryDocumentListItem[];
  /** Every folder by id, for O(1) lookups. */
  foldersById: Map<string, FolderListItem>;
  /** Every document by id, for O(1) lookups. */
  documentsById: Map<string, MemoryDocumentListItem>;
}

function sortFolders(nodes: MemoryFolderNode[]): void {
  nodes.sort(
    (a, b) => a.folder.position - b.folder.position || a.folder.name.localeCompare(b.folder.name),
  );
  for (const node of nodes) sortFolders(node.folders);
}

function sortDocuments(documents: MemoryDocumentListItem[]): void {
  documents.sort((a, b) => a.title.localeCompare(b.title));
}

export function buildMemoryTree(
  folders: FolderListItem[],
  documents: MemoryDocumentListItem[],
): MemoryTreeModel {
  const foldersById = new Map<string, FolderListItem>();
  const nodeById = new Map<string, MemoryFolderNode>();
  for (const folder of folders) {
    foldersById.set(folder.id, folder);
    nodeById.set(folder.id, { folder, folders: [], documents: [] });
  }

  const rootFolders: MemoryFolderNode[] = [];
  for (const folder of folders) {
    const node = nodeById.get(folder.id)!;
    // A parent outside the returned set would orphan the node, so it surfaces
    // at the root rather than disappearing from the rail.
    const parent = folder.parentId ? nodeById.get(folder.parentId) : undefined;
    if (parent) parent.folders.push(node);
    else rootFolders.push(node);
  }

  const documentsById = new Map<string, MemoryDocumentListItem>();
  const rootDocuments: MemoryDocumentListItem[] = [];
  for (const document of documents) {
    documentsById.set(document.id, document);
    const parent = document.folderId ? nodeById.get(document.folderId) : undefined;
    if (parent) parent.documents.push(document);
    else rootDocuments.push(document);
  }

  sortFolders(rootFolders);
  sortDocuments(rootDocuments);
  for (const node of nodeById.values()) sortDocuments(node.documents);

  return { folders: rootFolders, documents: rootDocuments, foldersById, documentsById };
}

/** The folder plus every folder nested beneath it — the illegal drop targets when dragging it. */
export function subtreeFolderIds(model: MemoryTreeModel, folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  const childrenByParent = new Map<string, string[]>();
  for (const folder of model.foldersById.values()) {
    if (!folder.parentId) continue;
    const siblings = childrenByParent.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    childrenByParent.set(folder.parentId, siblings);
  }
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (ids.has(child)) continue;
      ids.add(child);
      queue.push(child);
    }
  }
  return ids;
}

/** Root-to-folder trail, used for breadcrumbs and for the move picker's labels. */
export function folderBreadcrumbTrail(
  model: MemoryTreeModel,
  folderId: string | null,
): FolderListItem[] {
  const trail: FolderListItem[] = [];
  const seen = new Set<string>();
  let current = folderId ? model.foldersById.get(folderId) ?? null : null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = current.parentId ? model.foldersById.get(current.parentId) ?? null : null;
  }
  return trail;
}

/* ---- Drag and drop ---- */

/**
 * Droppable/draggable id protocol for the rail. Ids are prefixed so a single
 * DndContext can carry both node types, and two distinct ids resolve to the
 * root (the explicit "move out of folder" strip and the rail's empty space).
 */
export const MEMORY_ROOT_DROP_ID = "memory-root";
export const MEMORY_ROOT_AREA_DROP_ID = "memory-root-area";

export const memoryDragId = {
  document: (id: string) => `document:${id}`,
  folder: (id: string) => `folder:${id}`,
  parse: (raw: string) => {
    const separator = raw.indexOf(":");
    if (separator === -1) return { kind: raw, id: "" };
    return { kind: raw.slice(0, separator), id: raw.slice(separator + 1) };
  },
};

export function isMemoryRootTarget(id: string): boolean {
  return id === MEMORY_ROOT_DROP_ID || id === MEMORY_ROOT_AREA_DROP_ID;
}

export interface MemoryDropResolution {
  kind: "document" | "folder";
  id: string;
  /** `null` means the root, i.e. out of any folder. */
  targetFolderId: string | null;
}

/**
 * Decide what a drop should do, or `null` when it should do nothing.
 *
 * Returns `null` for: unknown nodes, a move that changes nothing, and dropping
 * a folder onto itself or one of its own descendants (which would detach the
 * subtree from the tree).
 */
export function resolveMemoryDrop(
  model: MemoryTreeModel,
  activeId: string,
  overId: string | null,
): MemoryDropResolution | null {
  if (!overId) return null;
  const source = memoryDragId.parse(activeId);
  const targetFolderId = isMemoryRootTarget(overId) ? null : memoryDragId.parse(overId).id;

  if (source.kind === "document") {
    const document = model.documentsById.get(source.id);
    if (!document) return null;
    if ((document.folderId ?? null) === targetFolderId) return null;
    if (targetFolderId && !model.foldersById.has(targetFolderId)) return null;
    return { kind: "document", id: source.id, targetFolderId };
  }

  if (source.kind === "folder") {
    const folder = model.foldersById.get(source.id);
    if (!folder) return null;
    if ((folder.parentId ?? null) === targetFolderId) return null;
    if (targetFolderId) {
      if (!model.foldersById.has(targetFolderId)) return null;
      if (subtreeFolderIds(model, source.id).has(targetFolderId)) return null;
    }
    return { kind: "folder", id: source.id, targetFolderId };
  }

  return null;
}

/** Flattened folder list for move pickers, carrying indentation depth. */
export function flattenFolders(
  nodes: MemoryFolderNode[],
  depth = 0,
): Array<{ folder: FolderListItem; depth: number }> {
  return nodes.flatMap((node) => [
    { folder: node.folder, depth },
    ...flattenFolders(node.folders, depth + 1),
  ]);
}
