import { useState } from "react";
import {
  DndContext,
  MouseSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FilePlus,
  FolderOutput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { FolderListItem, MemoryDocumentListItem } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  MEMORY_ROOT_AREA_DROP_ID,
  MEMORY_ROOT_DROP_ID,
  memoryDragId as dragId,
  resolveMemoryDrop,
  subtreeFolderIds,
  type MemoryFolderNode,
  type MemoryTreeModel,
} from "./memory-tree";

export interface MemoryTreeProps {
  model: MemoryTreeModel;
  selectedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  onCreateFolder: (parentId: string | null) => void;
  onCreateDocument: (folderId: string | null) => void;
  onRenameFolder: (folder: FolderListItem) => void;
  onDeleteFolder: (folder: FolderListItem) => void;
  onRenameDocument: (document: MemoryDocumentListItem) => void;
  onDeleteDocument: (document: MemoryDocumentListItem) => void;
  onMoveDocument: (documentId: string, folderId: string | null) => void;
  onMoveFolder: (folderId: string, parentId: string | null) => void;
}

const rowClass =
  "group/row flex h-8 w-full items-center gap-1.5 rounded-md pr-1 text-sm transition-colors";

function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Row actions"
          className="ml-auto opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocumentRow({
  document,
  depth,
  selected,
  onSelect,
  onRename,
  onDelete,
}: {
  document: MemoryDocumentListItem;
  depth: number;
  selected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId.document(document.id),
  });

  return (
    <div
      ref={setNodeRef}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      className={cn(
        rowClass,
        "cursor-pointer",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        isDragging && "opacity-50",
      )}
      data-testid="memory-document-row"
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{document.title}</span>
      <RowActions>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </RowActions>
    </div>
  );
}

function FolderRow({
  node,
  depth,
  expanded,
  onToggle,
  illegalDropTarget,
  props,
}: {
  node: MemoryFolderNode;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  illegalDropTarget: boolean;
  props: MemoryTreeProps;
}) {
  const folder = node.folder;
  const draggable = useDraggable({ id: dragId.folder(folder.id) });
  const droppable = useDroppable({ id: dragId.folder(folder.id), disabled: illegalDropTarget });
  const isOver = droppable.isOver && !illegalDropTarget;

  return (
    <div
      ref={droppable.setNodeRef}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      className={cn(
        rowClass,
        "cursor-pointer hover:bg-accent/50",
        isOver && "bg-accent ring-1 ring-ring",
        draggable.isDragging && "opacity-50",
      )}
      data-testid="memory-folder-row"
      onClick={onToggle}
    >
      <span ref={draggable.setNodeRef} className="flex min-w-0 items-center gap-1.5" {...draggable.attributes} {...draggable.listeners}>
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
        />
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{folder.name}</span>
      </span>
      <RowActions>
        <DropdownMenuItem onSelect={() => props.onCreateDocument(folder.id)}>
          <FilePlus /> New document
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => props.onCreateFolder(folder.id)}>
          <FolderPlus /> New subfolder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => props.onRenameFolder(folder)}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => props.onDeleteFolder(folder)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </RowActions>
    </div>
  );
}

function FolderBranch({
  node,
  depth,
  expandedIds,
  toggle,
  illegalDropTargets,
  props,
}: {
  node: MemoryFolderNode;
  depth: number;
  expandedIds: Set<string>;
  toggle: (folderId: string) => void;
  illegalDropTargets: Set<string>;
  props: MemoryTreeProps;
}) {
  const expanded = expandedIds.has(node.folder.id);
  return (
    <>
      <FolderRow
        node={node}
        depth={depth}
        expanded={expanded}
        onToggle={() => toggle(node.folder.id)}
        illegalDropTarget={illegalDropTargets.has(node.folder.id)}
        props={props}
      />
      {expanded ? (
        <>
          {node.folders.map((child) => (
            <FolderBranch
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggle={toggle}
              illegalDropTargets={illegalDropTargets}
              props={props}
            />
          ))}
          {node.documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              depth={depth + 1}
              selected={props.selectedDocumentId === document.id}
              onSelect={() => props.onSelectDocument(document.id)}
              onRename={() => props.onRenameDocument(document)}
              onDelete={() => props.onDeleteDocument(document)}
            />
          ))}
          {node.folders.length === 0 && node.documents.length === 0 ? (
            <p
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              className="py-1 text-xs text-muted-foreground"
            >
              Empty
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * Appears only mid-drag, and only when the dragged node actually sits inside a
 * folder. Floats over the bottom of the rail rather than taking part in the
 * layout: inserting a row at drag start would shove the tree down by its own
 * height, moving the folder the user was aiming at.
 */
function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: MEMORY_ROOT_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      data-testid="memory-root-drop-zone"
      className={cn(
        "absolute inset-x-2 bottom-2 z-10 flex h-9 items-center justify-center rounded-md border border-dashed text-xs shadow-sm backdrop-blur-sm transition-colors",
        isOver
          ? "border-ring bg-accent text-accent-foreground"
          : "border-border bg-background/90 text-muted-foreground",
      )}
    >
      <FolderOutput className="mr-1.5 size-3.5" />
      Move out of folder
    </div>
  );
}

export function MemoryTree(props: MemoryTreeProps) {
  const { model } = props;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeDrag, setActiveDrag] = useState<{ kind: string; id: string } | null>(null);
  const draggingFolderId = activeDrag?.kind === "folder" ? activeDrag.id : null;
  const sensors = useSensors(
    // Desktop-only drag, matching the projects rail: touch stays tap/scroll.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
  );
  const rootAreaDroppable = useDroppable({ id: MEMORY_ROOT_AREA_DROP_ID });

  // Only worth offering the escape hatch when the node is nested to begin with.
  const draggedIsNested = activeDrag
    ? activeDrag.kind === "document"
      ? (model.documentsById.get(activeDrag.id)?.folderId ?? null) !== null
      : (model.foldersById.get(activeDrag.id)?.parentId ?? null) !== null
    : false;

  const illegalDropTargets = draggingFolderId
    ? subtreeFolderIds(model, draggingFolderId)
    : new Set<string>();

  function toggle(folderId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    const drop = resolveMemoryDrop(model, String(active.id), over ? String(over.id) : null);
    if (!drop) return;
    if (drop.kind === "document") props.onMoveDocument(drop.id, drop.targetFolderId);
    else props.onMoveFolder(drop.id, drop.targetFolderId);
  }

  const empty = model.folders.length === 0 && model.documents.length === 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event) => setActiveDrag(dragId.parse(String(event.active.id)))}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex items-center gap-1 px-2 pb-2">
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          onClick={() => props.onCreateDocument(null)}
        >
          <FilePlus /> Document
        </Button>
        <Button
          variant="outline"
          size="xs"
          aria-label="New folder"
          onClick={() => props.onCreateFolder(null)}
        >
          <FolderPlus />
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
      {draggedIsNested ? <RootDropZone /> : null}

      <div
        ref={rootAreaDroppable.setNodeRef}
        data-testid="memory-tree"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto pb-2 scrollbar-auto-hide",
          rootAreaDroppable.isOver && "bg-accent/30",
          // Keep the last row reachable above the floating strip.
          draggedIsNested && "pb-14",
        )}
      >
        {empty ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No documents yet. Create one to start your knowledge base.
          </p>
        ) : null}
        {model.folders.map((node) => (
          <FolderBranch
            key={node.folder.id}
            node={node}
            depth={0}
            expandedIds={expandedIds}
            toggle={toggle}
            illegalDropTargets={illegalDropTargets}
            props={props}
          />
        ))}
        {model.documents.map((document) => (
          <DocumentRow
            key={document.id}
            document={document}
            depth={0}
            selected={props.selectedDocumentId === document.id}
            onSelect={() => props.onSelectDocument(document.id)}
            onRename={() => props.onRenameDocument(document)}
            onDelete={() => props.onDeleteDocument(document)}
          />
        ))}
      </div>
      </div>
    </DndContext>
  );
}
