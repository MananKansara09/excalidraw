import type { Folder } from "./api";

export type FolderNode = {
  folder: Folder;
  depth: number;
  /** "Parent / Child" */
  path: string;
  hasChildren: boolean;
};

/**
 * Folders (collections) as a depth-first list, each followed by its children,
 * with sibling folders sorted by name. Folders whose parent is missing are
 * treated as top-level, so nothing disappears.
 */
export const folderTree = (folders: readonly Folder[]): FolderNode[] => {
  const ids = new Set(folders.map((folder) => folder.id));
  const childrenOf = (parentId: string | null) =>
    folders
      .filter((folder) =>
        parentId === null
          ? !folder.parentId || !ids.has(folder.parentId)
          : folder.parentId === parentId,
      )
      .sort((a, b) => a.name.localeCompare(b.name));

  const out: FolderNode[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    for (const folder of childrenOf(parentId)) {
      if (seen.has(folder.id)) {
        continue;
      }
      seen.add(folder.id);
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name;
      const start = out.length;
      out.push({ folder, depth, path, hasChildren: false });
      walk(folder.id, depth + 1, path);
      out[start].hasChildren = out.length > start + 1;
    }
  };
  walk(null, 0, "");
  return out;
};

/** The folder and all of its ancestors, outermost first. */
export const folderAncestry = (
  folders: readonly Folder[],
  folderId: string | null,
): Folder[] => {
  const path: Folder[] = [];
  let cursor = folders.find((folder) => folder.id === folderId);
  while (cursor && !path.includes(cursor)) {
    path.unshift(cursor);
    const parentId: string | null = cursor.parentId;
    cursor = folders.find((folder) => folder.id === parentId);
  }
  return path;
};

/** Ids of a folder's descendants (not the folder itself). */
export const folderDescendants = (
  folders: readonly Folder[],
  folderId: string,
): Set<string> => {
  const out = new Set<string>();
  const queue = [folderId];
  while (queue.length) {
    const id = queue.pop()!;
    for (const folder of folders) {
      if (folder.parentId === id && !out.has(folder.id)) {
        out.add(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return out;
};
