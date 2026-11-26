import { fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types";

import { Provider, appJotaiStore } from "../app-jotai";
import { cloudSession } from "../plus/cloud";
import { PlusTopRight } from "../plus/components/PlusTopRight";
import {
  cloudCollaboratorsAtom,
  cloudFollowedActivityAtom,
  cloudSceneAtom,
  cloudUserToFollowAtom,
  connectionIdAtom,
  participantsAtom,
  plusUserAtom,
} from "../plus/state";

describe("cloud participant profile & follow", () => {
  beforeEach(() => {
    appJotaiStore.set(plusUserAtom, {
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      createdAt: 1,
      hasAIKey: false,
    });
    appJotaiStore.set(cloudSceneAtom, {
      id: "scene-1",
      name: "Architecture",
      role: "owner",
      teamId: null,
      presentation: [],
      shareToken: null,
      embed: false,
    });
    appJotaiStore.set(connectionIdAtom, "conn-me");
    appJotaiStore.set(participantsAtom, [
      {
        connectionId: "conn-bob",
        userId: "user-2",
        name: "Bob",
        color: "#ffd8a8",
        inHangout: false,
        sharingScreen: false,
      },
    ]);
    appJotaiStore.set(
      cloudCollaboratorsAtom,
      new Map<SocketId, Collaborator>([
        [
          "conn-bob" as SocketId,
          {
            id: "user-2",
            socketId: "conn-bob" as SocketId,
            username: "Bob",
            activity: { tool: "text", isEditingText: true },
          },
        ],
      ]),
    );
    appJotaiStore.set(cloudUserToFollowAtom, null);
    appJotaiStore.set(cloudFollowedActivityAtom, null);
  });

  afterEach(() => {
    cloudSession.setUserToFollow(null);
    vi.restoreAllMocks();
  });

  it("opens participant profile on click and starts/stops following their screen", async () => {
    (global as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    const signalSpy = vi
      .spyOn(cloudSession, "signal")
      .mockResolvedValue(undefined);

    const { container } = render(
      <Provider store={appJotaiStore}>
        <div className="excalidraw">
          <PlusTopRight />
        </div>
      </Provider>,
    );

    const avatarTrigger = container.querySelector<HTMLElement>(
      '[data-testid="collaborator-avatar-conn-bob"]',
    );
    expect(avatarTrigger).not.toBeNull();

    fireEvent.click(avatarTrigger!);

    await waitFor(() => {
      const profile = document.querySelector(
        '[data-testid="collaborator-profile-conn-bob"]',
      );
      expect(profile).not.toBeNull();
      expect(profile?.textContent).toContain("Bob");
      expect(profile?.textContent).toContain("Editing text");
    });

    const followButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="collaborator-follow-button"]',
    );
    expect(followButton?.textContent).toContain("Follow screen");

    fireEvent.click(followButton!);

    await waitFor(() => {
      expect(appJotaiStore.get(cloudUserToFollowAtom)).toEqual({
        socketId: "conn-bob",
        username: "Bob",
      });
    });

    // Clicking again opens profile with "Stop following" and unfollows on click
    fireEvent.click(avatarTrigger!);

    const stopButton = await waitFor(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="collaborator-follow-button"]',
      );
      expect(btn?.textContent).toContain("Stop following");
      return btn!;
    });

    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(appJotaiStore.get(cloudUserToFollowAtom)).toBeNull();
    });

    expect(signalSpy).toHaveBeenCalledWith("follow-stop", {}, "conn-bob");
  });

  it("renders user and participant avatars across top bar and profile popover", async () => {
    const adaAvatar =
      "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E";
    const bobAvatar =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9cAAAAASUVORK5CYII=";

    appJotaiStore.set(plusUserAtom, {
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: adaAvatar,
      createdAt: 1,
      hasAIKey: false,
    });
    appJotaiStore.set(participantsAtom, [
      {
        connectionId: "conn-bob",
        userId: "user-2",
        name: "Bob",
        avatarUrl: bobAvatar,
        color: "#ffd8a8",
        inHangout: false,
        sharingScreen: false,
      },
    ]);

    const { container } = render(
      <Provider store={appJotaiStore}>
        <div className="excalidraw">
          <PlusTopRight />
        </div>
      </Provider>,
    );

    const accountImg = container.querySelector<HTMLImageElement>(
      'button[aria-label="Account settings"] img',
    );
    expect(accountImg?.getAttribute("src")).toBe(adaAvatar);

    const bobTrigger = container.querySelector<HTMLElement>(
      '[data-testid="collaborator-avatar-conn-bob"]',
    );
    expect(bobTrigger?.querySelector("img")?.getAttribute("src")).toBe(
      bobAvatar,
    );

    fireEvent.click(bobTrigger!);

    await waitFor(() => {
      const profile = document.querySelector(
        '[data-testid="collaborator-profile-conn-bob"]',
      );
      expect(profile?.querySelector("img")?.getAttribute("src")).toBe(
        bobAvatar,
      );
    });
  });
});
