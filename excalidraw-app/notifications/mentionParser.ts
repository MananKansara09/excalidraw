import type { ExcalidrawElement } from "@excalidraw/element/types";

import { normalizeHandle } from "./identity";

import type { KnownUser } from "./types";

export interface ParsedMention {
  raw: string;
  handle: string;
  displayText: string;
  index: number;
}

const MAX_SNIPPET_LENGTH = 140;

// Matches @"Quoted Name" or @handle when preceded by start-of-string or non-word boundary
// (excluding emails like foo@bar.com and domains).
const MENTION_REGEX =
  /(^|[^a-zA-Z0-9._%+-])@(?:"([^"\r\n]{1,64})"|([a-zA-Z0-9][a-zA-Z0-9._-]{0,63}))/g;

/**
 * Extracts valid @mentions from canvas text, ignoring email addresses and
 * resolving multi-word known user display names when typed unquoted (e.g. `@Alice Smith`).
 */
export const extractMentions = (
  text: string,
  knownUsers: readonly KnownUser[] = [],
): ParsedMention[] => {
  if (!text || !text.includes("@")) {
    return [];
  }

  const results: ParsedMention[] = [];
  const seenOffsets = new Set<number>();

  // First check multi-word known users if typed directly after `@` (e.g. `@Alice Smith`)
  if (knownUsers.length > 0) {
    const sortedUsers = [...knownUsers].sort(
      (a, b) => b.username.length - a.username.length,
    );

    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "@") {
        continue;
      }
      const prevChar = i > 0 ? text[i - 1] : "";
      if (prevChar && /[a-zA-Z0-9._%+-]/.test(prevChar)) {
        continue;
      }

      const rest = text.slice(i + 1);
      const matchedUser = sortedUsers.find((user) => {
        if (!user.username || !user.username.includes(" ")) {
          return false;
        }
        const candidate = rest.slice(0, user.username.length);
        if (candidate.toLowerCase() !== user.username.toLowerCase()) {
          return false;
        }
        const nextChar = rest[user.username.length];
        return !nextChar || /[\s.,!?;:)\]]/.test(nextChar);
      });

      if (matchedUser) {
        seenOffsets.add(i);
        results.push({
          raw: `@${matchedUser.username}`,
          handle: matchedUser.handle,
          displayText: matchedUser.username,
          index: i,
        });
      }
    }
  }

  MENTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const prefix = match[1] ?? "";
    const atOffset = match.index + prefix.length;

    if (seenOffsets.has(atOffset)) {
      continue;
    }

    const quotedName = match[2];
    const token = match[3];
    const displayText = (quotedName || token || "").trim();
    if (!displayText) {
      continue;
    }

    seenOffsets.add(atOffset);
    results.push({
      raw: quotedName ? `@"${quotedName}"` : `@${token}`,
      handle: normalizeHandle(displayText),
      displayText,
      index: atOffset,
    });
  }

  return results.sort((a, b) => a.index - b.index);
};

export const buildTextSnippet = (text: string, mentionIndex = 0): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_SNIPPET_LENGTH) {
    return normalized;
  }
  const start = Math.max(0, mentionIndex - 40);
  const slice = normalized.slice(start, start + MAX_SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${slice}${
    start + MAX_SNIPPET_LENGTH < normalized.length ? "…" : ""
  }`;
};

export interface DetectedCanvasMention {
  elementId: string;
  containerId: string | null;
  handle: string;
  displayText: string;
  textSnippet: string;
  x: number;
  y: number;
}

/**
 * Tracks @mentions per canvas text element so notifications are emitted once
 * when a mention is committed (never on every keystroke while typing, and
 * never re-emitted on unrelated element moves/edits).
 */
export class MentionTracker {
  private seenMentionsByElement = new Map<string, Set<string>>();

  /**
   * Seeds tracker with existing elements (e.g. on initial scene load or
   * SCENE_INIT) so pre-existing canvas mentions don't flood on room join.
   */
  seedElements(
    elements: readonly ExcalidrawElement[],
    knownUsers: readonly KnownUser[] = [],
  ) {
    for (const element of elements) {
      if (element.isDeleted || element.type !== "text") {
        continue;
      }
      const text = element.originalText ?? element.text;
      const mentions = extractMentions(text, knownUsers);
      if (mentions.length > 0) {
        this.seenMentionsByElement.set(
          element.id,
          new Set(mentions.map((m) => m.handle)),
        );
      }
    }
  }

  /**
   * Processes committed text elements and returns only newly added mentions.
   */
  collectNewMentions(
    elements: readonly ExcalidrawElement[],
    opts: {
      editingElementId?: string | null;
      knownUsers?: readonly KnownUser[];
    } = {},
  ): DetectedCanvasMention[] {
    const { editingElementId = null, knownUsers = [] } = opts;
    const activeIds = new Set<string>();
    const detected: DetectedCanvasMention[] = [];

    for (const element of elements) {
      if (element.isDeleted || element.type !== "text") {
        continue;
      }

      activeIds.add(element.id);

      // Defer detection until the user finishes editing this text element
      if (editingElementId && element.id === editingElementId) {
        continue;
      }

      const text = element.originalText ?? element.text;
      const mentions = extractMentions(text, knownUsers);
      const prevSeen = this.seenMentionsByElement.get(element.id);

      if (mentions.length === 0) {
        if (prevSeen) {
          this.seenMentionsByElement.delete(element.id);
        }
        continue;
      }

      const nextSeen = new Set<string>();
      for (const mention of mentions) {
        nextSeen.add(mention.handle);
        if (!prevSeen?.has(mention.handle)) {
          detected.push({
            elementId: element.id,
            containerId: element.containerId ?? null,
            handle: mention.handle,
            displayText: mention.displayText,
            textSnippet: buildTextSnippet(text, mention.index),
            x: element.x,
            y: element.y,
          });
        }
      }

      this.seenMentionsByElement.set(element.id, nextSeen);
    }

    // Prune deleted or removed elements to keep memory bounded
    for (const trackedId of this.seenMentionsByElement.keys()) {
      if (!activeIds.has(trackedId)) {
        this.seenMentionsByElement.delete(trackedId);
      }
    }

    return detected;
  }

  reset() {
    this.seenMentionsByElement.clear();
  }
}
