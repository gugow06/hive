import { describe, expect, it } from "vitest";
import type { FolderListItem, MemoryDocumentListItem } from "@paperclipai/shared";
import {
  MEMORY_ROOT_AREA_DROP_ID,
  MEMORY_ROOT_DROP_ID,
  buildMemoryTree,
  flattenFolders,
  folderBreadcrumbTrail,
  memoryDragId,
  resolveMemoryDrop,
  subtreeFolderIds,
} from "./memory-tree";

function folder(
  id: string,
  name: string,
  parentId: string | null,
  position = 0,
): FolderListItem {
  return {
    id,
    companyId: "company-1",
    kind: "memory",
    parentId,
    name,
    slug: name.toLowerCase(),
    systemKey: null,
    path: parentId ? `${parentId}/${name.toLowerCase()}` : name.toLowerCase(),
    depth: parentId ? 2 : 1,
    color: null,
    position,
    itemCount: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function document(id: string, title: string, folderId: string | null): MemoryDocumentListItem {
  return {
    id,
    companyId: "company-1",
    folderId,
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

describe("buildMemoryTree", () => {
  it("nests folders under their parent", () => {
    const model = buildMemoryTree(
      [folder("root", "Root", null), folder("child", "Child", "root")],
      [],
    );
    expect(model.folders).toHaveLength(1);
    expect(model.folders[0]!.folder.id).toBe("root");
    expect(model.folders[0]!.folders[0]!.folder.id).toBe("child");
  });

  it("places documents inside their folder and unfiled ones at the root", () => {
    const model = buildMemoryTree(
      [folder("root", "Root", null)],
      [document("d1", "Inside", "root"), document("d2", "Outside", null)],
    );
    expect(model.folders[0]!.documents.map((d) => d.id)).toEqual(["d1"]);
    expect(model.documents.map((d) => d.id)).toEqual(["d2"]);
  });

  it("surfaces a document whose folder is missing rather than dropping it", () => {
    const model = buildMemoryTree([], [document("d1", "Orphan", "gone")]);
    expect(model.documents.map((d) => d.id)).toEqual(["d1"]);
  });

  it("orders folders by position then name, and documents by title", () => {
    const model = buildMemoryTree(
      [folder("b", "Beta", null, 1), folder("a", "Alpha", null, 0)],
      [document("d2", "Zebra", null), document("d1", "Apple", null)],
    );
    expect(model.folders.map((n) => n.folder.id)).toEqual(["a", "b"]);
    expect(model.documents.map((d) => d.title)).toEqual(["Apple", "Zebra"]);
  });

  it("indexes folders and documents by id", () => {
    const model = buildMemoryTree([folder("root", "Root", null)], [document("d1", "Doc", "root")]);
    expect(model.foldersById.get("root")?.name).toBe("Root");
    expect(model.documentsById.get("d1")?.title).toBe("Doc");
  });
});

describe("subtreeFolderIds", () => {
  it("returns the folder plus every descendant", () => {
    const model = buildMemoryTree(
      [
        folder("root", "Root", null),
        folder("child", "Child", "root"),
        folder("grandchild", "Grandchild", "child"),
        folder("other", "Other", null),
      ],
      [],
    );
    expect(subtreeFolderIds(model, "root")).toEqual(
      new Set(["root", "child", "grandchild"]),
    );
    expect(subtreeFolderIds(model, "other")).toEqual(new Set(["other"]));
  });
});

describe("folderBreadcrumbTrail", () => {
  it("walks from the root down to the folder", () => {
    const model = buildMemoryTree(
      [folder("root", "Root", null), folder("child", "Child", "root")],
      [],
    );
    expect(folderBreadcrumbTrail(model, "child").map((f) => f.id)).toEqual(["root", "child"]);
    expect(folderBreadcrumbTrail(model, null)).toEqual([]);
  });
});

describe("resolveMemoryDrop", () => {
  const model = buildMemoryTree(
    [
      folder("root", "Root", null),
      folder("child", "Child", "root"),
      folder("other", "Other", null),
    ],
    [document("inside", "Inside", "root"), document("loose", "Loose", null)],
  );

  it("moves a document out of its folder when dropped on the root strip", () => {
    expect(
      resolveMemoryDrop(model, memoryDragId.document("inside"), MEMORY_ROOT_DROP_ID),
    ).toEqual({ kind: "document", id: "inside", targetFolderId: null });
  });

  it("also unfiles a document dropped on the rail's empty area", () => {
    expect(
      resolveMemoryDrop(model, memoryDragId.document("inside"), MEMORY_ROOT_AREA_DROP_ID),
    ).toEqual({ kind: "document", id: "inside", targetFolderId: null });
  });

  it("moves a folder out to the root", () => {
    expect(
      resolveMemoryDrop(model, memoryDragId.folder("child"), MEMORY_ROOT_DROP_ID),
    ).toEqual({ kind: "folder", id: "child", targetFolderId: null });
  });

  it("moves a document into a folder", () => {
    expect(
      resolveMemoryDrop(model, memoryDragId.document("loose"), memoryDragId.folder("other")),
    ).toEqual({ kind: "document", id: "loose", targetFolderId: "other" });
  });

  it("does nothing when the document is already at the root", () => {
    expect(resolveMemoryDrop(model, memoryDragId.document("loose"), MEMORY_ROOT_DROP_ID)).toBeNull();
  });

  it("does nothing when the document is already in the target folder", () => {
    expect(
      resolveMemoryDrop(model, memoryDragId.document("inside"), memoryDragId.folder("root")),
    ).toBeNull();
  });

  it("refuses to drop a folder into itself or its own descendant", () => {
    expect(
      resolveMemoryDrop(model, memoryDragId.folder("root"), memoryDragId.folder("root")),
    ).toBeNull();
    expect(
      resolveMemoryDrop(model, memoryDragId.folder("root"), memoryDragId.folder("child")),
    ).toBeNull();
  });

  it("ignores drops with no target, or onto unknown nodes", () => {
    expect(resolveMemoryDrop(model, memoryDragId.document("inside"), null)).toBeNull();
    expect(
      resolveMemoryDrop(model, memoryDragId.document("ghost"), MEMORY_ROOT_DROP_ID),
    ).toBeNull();
    expect(
      resolveMemoryDrop(model, memoryDragId.document("loose"), memoryDragId.folder("ghost")),
    ).toBeNull();
  });

  it("round-trips ids that contain a colon", () => {
    expect(memoryDragId.parse(memoryDragId.folder("a:b"))).toEqual({ kind: "folder", id: "a:b" });
  });
});

describe("flattenFolders", () => {
  it("emits each folder with its indentation depth", () => {
    const model = buildMemoryTree(
      [folder("root", "Root", null), folder("child", "Child", "root")],
      [],
    );
    expect(flattenFolders(model.folders)).toEqual([
      { folder: model.foldersById.get("root"), depth: 0 },
      { folder: model.foldersById.get("child"), depth: 1 },
    ]);
  });
});
