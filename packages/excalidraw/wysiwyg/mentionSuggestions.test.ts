import {
  createMentionSuggestions,
  getMentionableUsers,
} from "./mentionSuggestions";

import type { Collaborator, SocketId } from "../types";

const sid = (id: string) => id as SocketId;

const collaborators = new Map<SocketId, Collaborator>([
  [sid("a"), { username: "Alice", id: "u1" }],
  [sid("a2"), { username: "Alice", id: "u1" }], // same user, second client
  [sid("b"), { username: "Bob", id: "u2" }],
  [sid("me"), { username: "Me", isCurrentUser: true }],
  [sid("anon"), { username: "  " }],
  [sid("none"), {}],
]);

describe("getMentionableUsers", () => {
  it("lists shared users once, without the current or unnamed ones", () => {
    expect(getMentionableUsers(collaborators).map((u) => u.username)).toEqual([
      "Alice",
      "Bob",
    ]);
  });
});

describe("createMentionSuggestions", () => {
  const setup = () => {
    const container = document.createElement("div");
    const editable = document.createElement("textarea");
    container.append(editable);
    document.body.append(container);
    const mentions = createMentionSuggestions({
      editable,
      container,
      getCollaborators: () => collaborators,
      getCaretViewportBounds: () => ({ left: 0, bottom: 0 }),
      getContainerOffsetLeft: () => 0,
    });
    const type = (value: string) => {
      editable.value = value;
      editable.setSelectionRange(value.length, value.length);
      editable.dispatchEvent(new Event("input"));
    };
    const items = () =>
      [
        ...container.querySelectorAll(
          ".excalidraw-mention-item > span:last-child",
        ),
      ].map((el) => el.textContent);
    return { container, editable, mentions, type, items };
  };

  it("shows only shared users on '@' and filters as you type", () => {
    const { type, items } = setup();
    type("hi @");
    expect(items()).toEqual(["Alice", "Bob"]);
    type("hi @bo");
    expect(items()).toEqual(["Bob"]);
    type("hi @zzz");
    expect(items()).toEqual([]);
    type("hi there");
    expect(items()).toEqual([]);
  });

  it("inserts the picked user with the keyboard", () => {
    const { type, editable, mentions, items } = setup();
    type("hi @");
    const key = (k: string) =>
      mentions.handleKeyDown(new KeyboardEvent("keydown", { key: k }));
    expect(key("ArrowDown")).toBe(true);
    expect(key("Enter")).toBe(true);
    expect(editable.value).toBe("hi @Bob ");
    expect(items()).toEqual([]);
  });

  it("does not hijack keys while closed", () => {
    const { mentions } = setup();
    expect(
      mentions.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" })),
    ).toBe(false);
  });
});
