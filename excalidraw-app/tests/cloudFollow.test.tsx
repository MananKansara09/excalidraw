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
      slidesOnly: false,
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
        cameraOn: false,
        cameraStreamId: null,
        screenStreamId: null,
        presenting: false,
        slide: 0,
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
        cameraOn: false,
        cameraStreamId: null,
        screenStreamId: null,
        presenting: false,
        slide: 0,
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

  it("syncs followed user viewport bounds and zoom over cloudSession signals", async () => {
    const updateScene = vi.fn();
    let scrollState = {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as any },
      width: 1000,
      height: 500,
      offsetLeft: 0,
      offsetTop: 0,
    };

    (cloudSession as any).api = {
      getAppState: () => scrollState,
      updateScene,
    };
    (cloudSession as any).scene = {
      id: "scene-1",
      name: "Architecture",
      role: "owner",
      teamId: null,
      presentation: [],
      shareToken: null,
      embed: false,
    };
    appJotaiStore.set(connectionIdAtom, "conn-me");

    const signalSpy = vi
      .spyOn(cloudSession, "signal")
      .mockResolvedValue(undefined);

    cloudSession.setUserToFollow({
      socketId: "conn-bob" as SocketId,
      username: "Bob",
    });
    expect(signalSpy).toHaveBeenCalledWith("follow-start", {}, "conn-bob");

    // Simulate receiving zoomed-in viewport bounds from Bob (500x250 scene box)
    (cloudSession as any).handleEvent("signal", {
      type: "viewport",
      from: "conn-bob",
      data: { sceneBounds: [100, 50, 600, 300] },
    });

    expect(updateScene).toHaveBeenCalledTimes(1);
    const firstUpdate = updateScene.mock.calls[0][0].appState;
    expect(firstUpdate.zoom.value).toBeCloseTo(2);
    expect(firstUpdate.scrollX).toBeCloseTo(-100);
    expect(firstUpdate.scrollY).toBeCloseTo(-50);

    // Simulate receiving zoomed-out viewport bounds from Bob (2000x1000 scene box)
    (cloudSession as any).handleEvent("signal", {
      type: "viewport",
      from: "conn-bob",
      data: { sceneBounds: [-500, -250, 1500, 750] },
    });

    expect(updateScene).toHaveBeenCalledTimes(2);
    const secondUpdate = updateScene.mock.calls[1][0].appState;
    expect(secondUpdate.zoom.value).toBeCloseTo(0.5);
    expect(secondUpdate.scrollX).toBeCloseTo(500);
    expect(secondUpdate.scrollY).toBeCloseTo(250);

    // Simulate someone else starting to follow us -> immediately replies with our viewport bounds
    scrollState = {
      ...scrollState,
      scrollX: -40,
      scrollY: -20,
      zoom: { value: 1 },
    };
    (cloudSession as any).handleEvent("signal", {
      type: "follow-start",
      from: "conn-carol",
      data: {},
    });
    expect(signalSpy).toHaveBeenCalledWith(
      "viewport",
      { sceneBounds: [40, 20, 1040, 520] },
      "conn-carol",
    );

    cloudSession.setUserToFollow(null);
    (cloudSession as any).followers.clear();
    (cloudSession as any).api = null;
    (cloudSession as any).scene = null;
  });
});
