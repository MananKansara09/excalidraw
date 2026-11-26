import { KEYS } from "@excalidraw/common";

import type { Collaborator } from "../types";

export type MentionableUser = {
  key: string;
  username: string;
  avatarUrl?: string;
  color?: Collaborator["color"];
};

/**
 * The users that can be mentioned: the ones in the shared (collaborators)
 * list, as the UserList shows them. The current user and users without a
 * username are left out, and a user connected from several clients is listed
 * once.
 */
export const getMentionableUsers = (
  collaborators: ReadonlyMap<string, Collaborator>,
): MentionableUser[] => {
  const users = new Map<string, MentionableUser>();
  for (const [socketId, collaborator] of collaborators) {
    const username = collaborator.username?.trim();
    if (!username || collaborator.isCurrentUser) {
      continue;
    }
    const key = collaborator.id ?? socketId;
    if (!users.has(key)) {
      users.set(key, {
        key,
        username,
        avatarUrl: collaborator.avatarUrl,
        color: collaborator.color,
      });
    }
  }
  return [...users.values()];
};

/** the `@query` the caret is at the end of, if any */
const getMentionTrigger = (value: string, caret: number) => {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
  if (!match) {
    return null;
  }
  const query = match[1];
  return { query, start: caret - query.length - 1 };
};

/**
 * Suggests the shared users to mention when `@` is typed into `editable`.
 * Arrow keys / Enter / Tab / Escape drive the list while it is open.
 */
export const createMentionSuggestions = ({
  editable,
  container,
  getCollaborators,
  getCaretViewportBounds,
  getContainerOffsetLeft,
}: {
  editable: HTMLTextAreaElement;
  /** where the popup is placed; positioned like the editor itself */
  container: HTMLElement;
  getCollaborators: () => ReadonlyMap<string, Collaborator>;
  getCaretViewportBounds: () => { left: number; bottom: number } | null;
  getContainerOffsetLeft: () => number;
}) => {
  const ownerDocument = editable.ownerDocument;
  let popup: HTMLDivElement | null = null;
  let users: MentionableUser[] = [];
  let activeIndex = 0;
  let trigger: ReturnType<typeof getMentionTrigger> = null;

  const close = () => {
    popup?.remove();
    popup = null;
    users = [];
    trigger = null;
  };

  const select = (user: MentionableUser) => {
    if (!trigger) {
      return;
    }
    const { value, selectionStart } = editable;
    const insert = `@${user.username} `;
    editable.value =
      value.slice(0, trigger.start) + insert + value.slice(selectionStart);
    const caret = trigger.start + insert.length;
    editable.setSelectionRange(caret, caret);
    close();
    // lets the editor resize and report the change
    editable.dispatchEvent(new Event("input"));
  };

  const renderItems = () => {
    if (!popup) {
      return;
    }
    popup.replaceChildren();
    users.forEach((user, index) => {
      const item = ownerDocument.createElement("div");
      item.className = "excalidraw-mention-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === activeIndex));
      if (index === activeIndex) {
        item.classList.add("is-active");
      }

      const avatar = ownerDocument.createElement("span");
      avatar.className = "excalidraw-mention-avatar";
      if (user.avatarUrl) {
        const img = ownerDocument.createElement("img");
        img.src = user.avatarUrl;
        img.alt = "";
        avatar.append(img);
      } else {
        avatar.textContent = Array.from(user.username)[0]?.toUpperCase() ?? "";
        if (user.color) {
          avatar.style.background = user.color.background;
        }
      }

      const name = ownerDocument.createElement("span");
      name.textContent = user.username;

      item.append(avatar, name);
      // keep the focus in the editor: a blur would submit the text
      item.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      item.onclick = () => select(user);
      popup!.append(item);
    });
  };

  const position = () => {
    const caret = getCaretViewportBounds();
    if (!popup || !caret) {
      return;
    }
    popup.style.left = `${caret.left - getContainerOffsetLeft()}px`;
    popup.style.top = `${caret.bottom + 4}px`;
  };

  /** call when the text or the caret changed */
  const update = () => {
    const next = getMentionTrigger(editable.value, editable.selectionStart);
    if (!next || editable.selectionStart !== editable.selectionEnd) {
      close();
      return;
    }
    const query = next.query.toLowerCase();
    const matches = getMentionableUsers(getCollaborators()).filter((user) =>
      user.username.toLowerCase().includes(query),
    );
    if (!matches.length) {
      close();
      return;
    }
    // keep the highlighted user while the list is filtered
    const previous = users[activeIndex]?.key;
    users = matches;
    trigger = next;
    activeIndex = Math.max(
      0,
      users.findIndex((user) => user.key === previous),
    );
    if (!popup) {
      popup = ownerDocument.createElement("div");
      popup.className = "excalidraw-mention-popup";
      popup.setAttribute("role", "listbox");
      container.append(popup);
    }
    renderItems();
    position();
  };

  /** @returns whether the event was used by the suggestions */
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!popup || event.isComposing) {
      return false;
    }
    const move = (delta: number) => {
      activeIndex = (activeIndex + delta + users.length) % users.length;
      renderItems();
    };
    if (event.key === KEYS.ARROW_DOWN) {
      move(1);
    } else if (event.key === KEYS.ARROW_UP) {
      move(-1);
    } else if (
      (event.key === KEYS.ENTER && !event[KEYS.CTRL_OR_CMD]) ||
      event.key === KEYS.TAB
    ) {
      select(users[activeIndex]);
    } else if (event.key === KEYS.ESCAPE) {
      close();
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  editable.addEventListener("input", update);
  // the caret moved without typing
  editable.addEventListener("keyup", (event) => {
    if (event.key === KEYS.ARROW_LEFT || event.key === KEYS.ARROW_RIGHT) {
      update();
    }
  });
  editable.addEventListener("click", update);

  return { handleKeyDown, destroy: close, reposition: position };
};
