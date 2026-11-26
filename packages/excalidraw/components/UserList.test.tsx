import React from "react";

import { UserIdleState } from "@excalidraw/common";

import { Excalidraw } from "../index";
import {
  act,
  fireEvent,
  getByText,
  render,
  waitFor,
} from "../tests/test-utils";

import type { Collaborator, SocketId, UserToFollow } from "../types";

const socketId = (id: string) => id as SocketId;

describe("UserList", () => {
  it("retains the local dropdown when the same account has multiple clients", async () => {
    const { container } = await render(
      <Excalidraw
        currentUserControls={<button type="button">Spotlight me</button>}
      />,
    );
    const currentSocketId = socketId("current");
    const otherSocketId = socketId("other");

    act(() => {
      window.h.app.updateScene({
        collaborators: new Map<SocketId, Collaborator>([
          [
            otherSocketId,
            {
              id: "user",
              socketId: otherSocketId,
              username: "Ada",
              isCurrentUser: false,
            },
          ],
          [
            currentSocketId,
            {
              id: "user",
              socketId: currentSocketId,
              username: "Ada",
              isCurrentUser: true,
            },
          ],
        ]),
      });
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".UserList__pill")).toHaveLength(1);
    });

    const currentUserPill =
      container.querySelector<HTMLElement>(".UserList__pill");
    expect(currentUserPill).not.toBeNull();

    // Radix Popover measures its content when opened.
    (global as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    fireEvent.click(currentUserPill!);

    await waitFor(() => {
      const dropdown = document.querySelector(".UserList__collaborators");
      const dropdownCollaborators = dropdown?.querySelectorAll(
        ".UserList__collaborator",
      );
      expect(dropdownCollaborators).toHaveLength(2);
      expect(
        dropdown?.querySelectorAll(".UserList__collaborator.is-current-user"),
      ).toHaveLength(1);
      expect(getByText(document.body, "Spotlight me")).toBeVisible();
    });
  });

  it("opens collaborator profile on user icon click and allows following/unfollowing", async () => {
    const onUserFollow = vi.fn();
    const currentSocketId = socketId("current");
    const otherSocketId = socketId("other");

    const ControlledHost = () => {
      const [userToFollow, setUserToFollow] =
        React.useState<UserToFollow | null>(null);

      return (
        <Excalidraw
          userToFollow={userToFollow}
          onUserFollow={(payload) => {
            onUserFollow(payload);
            setUserToFollow(
              payload.action === "FOLLOW" ? payload.userToFollow : null,
            );
          }}
        />
      );
    };

    (global as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    const { container } = await render(<ControlledHost />);

    act(() => {
      window.h.app.updateScene({
        collaborators: new Map<SocketId, Collaborator>([
          [
            otherSocketId,
            {
              id: "user-2",
              socketId: otherSocketId,
              username: "Bob",
              userState: UserIdleState.ACTIVE,
              activity: { tool: "freedraw", isDrawing: true },
              isCurrentUser: false,
            },
          ],
          [
            currentSocketId,
            {
              id: "user-1",
              socketId: currentSocketId,
              username: "Ada",
              isCurrentUser: true,
            },
          ],
        ]),
      });
    });

    const avatarTrigger = await waitFor(() => {
      const el = container.querySelector<HTMLElement>(
        `[data-testid="collaborator-avatar-${otherSocketId}"]`,
      );
      expect(el).not.toBeNull();
      return el!;
    });

    // Clicking the collaborator's user icon opens their profile instead of immediately following
    fireEvent.click(avatarTrigger);

    await waitFor(() => {
      const profile = document.querySelector(
        `[data-testid="collaborator-profile-${otherSocketId}"]`,
      );
      expect(profile).not.toBeNull();
      expect(profile?.textContent).toContain("Bob");
      expect(profile?.textContent).toContain("Active");
      expect(profile?.textContent).toContain("Drawing");
    });

    expect(onUserFollow).not.toHaveBeenCalled();

    const followButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="collaborator-follow-button"]',
    );
    expect(followButton?.textContent).toContain("Follow screen");

    fireEvent.click(followButton!);

    expect(onUserFollow).toHaveBeenCalledTimes(1);
    expect(onUserFollow).toHaveBeenLastCalledWith({
      action: "FOLLOW",
      userToFollow: { socketId: otherSocketId, username: "Bob" },
    });

    // Profile popover closes after starting follow, and avatar reflects followed state
    await waitFor(() => {
      expect(
        document.querySelector(
          `[data-testid="collaborator-profile-${otherSocketId}"]`,
        ),
      ).toBeNull();
      expect(
        avatarTrigger.querySelector(".UserList__collaborator.is-followed"),
      ).not.toBeNull();
    });

    // Re-opening the user profile shows "Stop following" and unfollows on click
    fireEvent.click(avatarTrigger);

    const stopButton = await waitFor(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="collaborator-follow-button"]',
      );
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toContain("Stop following");
      return btn!;
    });

    fireEvent.click(stopButton);

    expect(onUserFollow).toHaveBeenCalledTimes(2);
    expect(onUserFollow).toHaveBeenLastCalledWith({
      action: "UNFOLLOW",
      userToFollow: { socketId: otherSocketId, username: "Bob" },
    });
  });
});
