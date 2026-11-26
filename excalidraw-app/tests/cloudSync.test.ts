import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudSession } from "../plus/cloud";
import { appJotaiStore } from "../app-jotai";
import { cloudStatusAtom } from "../plus/state";

vi.mock("../plus/api", () => ({
  plusAPI: {
    eventsURL: () => "http://test/events",
    listComments: vi.fn(async () => ({ comments: [] })),
    getScene: vi.fn(async () => ({
      scene: { elements: [], files: {} },
    })),
    syncScene: vi.fn(async () => ({})),
    updateScene: vi.fn(async () => ({})),
    signal: vi.fn(async () => ({})),
    getSceneFiles: vi.fn(async () => ({ files: {} })),
  },
  PlusAPIError: class extends Error {
    status = 0;
  },
  setActiveShareToken: () => {},
}));

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((event: any) => void)[]>();

  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: unknown = {}) {
    this.readyState = FakeEventSource.OPEN;
    this.listeners
      .get(type)
      ?.forEach((handler) => handler({ data: JSON.stringify(data) }));
  }
  /** What a browser does when a reconnect gets an HTTP error response. */
  failForGood() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

const startSession = () => {
  const api: any = {
    getSceneElementsIncludingDeleted: () => [],
    getAppState: () => ({
      selectedElementIds: {},
      viewBackgroundColor: "#ffffff",
      name: "scene",
    }),
    getFiles: () => ({}),
    addFiles: vi.fn(),
    updateScene: vi.fn(),
    setToast: vi.fn(),
  };
  cloudSession.start(
    api,
    {
      id: "scene-1",
      name: "scene",
      role: "editor",
      elements: [],
      files: {},
      appState: { viewBackgroundColor: "#ffffff" },
      presentation: [],
    } as any,
    { sceneId: "scene-1", shareToken: null, embed: false },
  );
};

describe("cloud scene event stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    (globalThis as any).EventSource = FakeEventSource;
  });

  afterEach(() => {
    cloudSession.stop();
    vi.useRealTimers();
  });

  it("reopens a stream the browser gave up on and resyncs", async () => {
    const { plusAPI } = await import("../plus/api");
    startSession();
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].emit("hello", { connectionId: "a" });

    // e.g. a proxy answers 502 while the server restarts
    FakeEventSource.instances[0].failForGood();
    expect(appJotaiStore.get(cloudStatusAtom).state).toBe("offline");

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(2);

    (plusAPI.getScene as any).mockClear();
    FakeEventSource.instances[1].emit("hello", { connectionId: "b" });
    // what was missed while the stream was down is fetched again
    expect(plusAPI.getScene).toHaveBeenCalledWith("scene-1");
    expect(appJotaiStore.get(cloudStatusAtom).state).toBe("saved");
  });

  it("backs off between failed reconnects", async () => {
    startSession();
    FakeEventSource.instances[0].failForGood();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1].failForGood();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("reopens a stream that went silent", async () => {
    startSession();
    FakeEventSource.instances[0].emit("hello", { connectionId: "a" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(FakeEventSource.instances.length).toBeGreaterThan(1);
    expect(appJotaiStore.get(cloudStatusAtom).state).toBe("offline");
  });

  it("stays connected while the server's pings arrive", async () => {
    startSession();
    FakeEventSource.instances[0].emit("hello", { connectionId: "a" });
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(25_000);
      FakeEventSource.instances[0].emit("ping");
    }
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("stops reconnecting once the scene is closed", async () => {
    startSession();
    FakeEventSource.instances[0].failForGood();
    cloudSession.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
