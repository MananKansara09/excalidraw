import { atom, editorJotaiStore } from "../../editor-jotai";

import type React from "react";

export type OverwriteConfirmState =
  | {
      active: true;
      title: string;
      description: React.ReactNode;
      actionLabel: string;
      color: "danger" | "warning";

      onClose: () => void;
      onConfirm: () => void;
      onReject: () => void;
    }
  | { active: false };

export const overwriteConfirmStateAtom = atom<OverwriteConfirmState>({
  active: false,
});

/** Dismisses the open confirm modal, same as the user closing it. */
export function closeConfirmModal() {
  const state = editorJotaiStore.get(overwriteConfirmStateAtom);
  if (state.active) {
    state.onClose();
    editorJotaiStore.set(overwriteConfirmStateAtom, { active: false });
  }
}

export async function openConfirmModal({
  title,
  description,
  actionLabel,
  color,
}: {
  title: string;
  description: React.ReactNode;
  actionLabel: string;
  color: "danger" | "warning";
}) {
  return new Promise<boolean>((resolve) => {
    editorJotaiStore.set(overwriteConfirmStateAtom, {
      active: true,
      onConfirm: () => resolve(true),
      onClose: () => resolve(false),
      onReject: () => resolve(false),
      title,
      description,
      actionLabel,
      color,
    });
  });
}
