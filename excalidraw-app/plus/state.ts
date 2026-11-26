import { atom } from "../app-jotai";

import type { PlusComment, PlusUser, SceneRole } from "./api";

/** `undefined` while the session is being checked. */
export const plusUserAtom = atom<PlusUser | null | undefined>(undefined);

export type PlusDialog =
  | { name: "workspace" }
  | { name: "account" }
  | { name: "share" }
  | { name: "export-frames" }
  | { name: "save-to-cloud" };

export const plusDialogAtom = atom<PlusDialog | null>(null);

export type CloudScene = {
  id: string;
  name: string;
  role: SceneRole;
  teamId: string | null;
  presentation: string[];
  /** Opened through `#share=` (no account needed). */
  shareToken: string | null;
  /** Rendered inside an iframe embed: view-only, no chrome. */
  embed: boolean;
  /** Opened through a presentation link: only the slides, nothing else. */
  slidesOnly: boolean;
};

export const cloudSceneAtom = atom<CloudScene | null>(null);

export type CloudStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; at: number }
  | { state: "error"; message: string }
  | { state: "offline" };

export const cloudStatusAtom = atom<CloudStatus>({ state: "idle" });

export type Participant = {
  connectionId: string;
  userId: string | null;
  name: string;
  color: string;
  inHangout: boolean;
  sharingScreen: boolean;
  /** Running a presentation, currently on slide `slide`. */
  presenting: boolean;
  slide: number;
};

export const participantsAtom = atom<Participant[]>([]);
export const connectionIdAtom = atom<string | null>(null);

export const commentsAtom = atom<PlusComment[]>([]);
/** Comment thread highlighted from a canvas pin. */
export const activeCommentIdAtom = atom<string | null>(null);

export const presentationAtom = atom<{
  active: boolean;
  index: number;
  /** Watching someone else's presentation instead of driving one. */
  watching?: boolean;
}>({ active: false, index: 0 });

/** A live presentation to start watching once its scene has opened. */
export const pendingWatchAtom = atom<{ sceneId: string } | null>(null);

/** Frame order for presenting scenes that aren't in the cloud. */
export const localPresentationOrderAtom = atom<string[]>([]);

/** Unread @-mentions of the signed-in user, for the Workspace badge. */
export const mentionsUnreadAtom = atom(0);

/** A comment to show once its scene has opened (from the mentions inbox). */
export const pendingCommentFocusAtom = atom<{
  sceneId: string;
  commentId: string;
} | null>(null);
