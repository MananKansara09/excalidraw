import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudSession } from "../plus/cloud";

vi.mock("../plus/api", () => ({
  plusAPI: {
    eventsURL: () => "http://test/events",
    socketURL: () => "ws://test/ws",
    listComments: vi.fn(async () => ({ comments: [] })),
    getScene: vi.fn(async () => ({ scene: { elements: [], files: {} } })),
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
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  /** What a browser does when a reconnect gets an HTTP error response. */
  failForGood() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

const startSession = () => {
  const api: any = {
    getAppState: () => ({ width: 800, height: 600, selectedElementIds: {} }),
    onScrollChange: () => () => {},
    getSceneElementsIncludingDeleted: () => [],
    getFiles: () => ({}),
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
      appState: {},
      presentation: [],
    } as any,
    { sceneId: "scene-1", shareToken: null, embed: false },
  );
};

// WebSockets are the primary transport; SSE is the fallback where they are
// blocked, and must survive a server restart behind a proxy too.
describe("cloud scene SSE fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("WebSocket", undefined);
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cloudSession.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reopens a stream the browser gave up on", async () => {
    startSession();
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].failForGood();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("backs off between failed reconnects", async () => {
    startSession();
    FakeEventSource.instances[0].failForGood();
    await vi.advanceTimersByTimeAsync(500);
    FakeEventSource.instances[1].failForGood();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("leaves a stream the browser is retrying alone", async () => {
    startSession();
    FakeEventSource.instances[0].readyState = FakeEventSource.CONNECTING;
    FakeEventSource.instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(60_000);
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
