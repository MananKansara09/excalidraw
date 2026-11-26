import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { appJotaiStore } from "../app-jotai";
import {
  extractMentions,
  MentionTracker,
  normalizeHandle,
  matchesRecipient,
  NotificationEngine,
  MAX_STORED_NOTIFICATIONS,
  MAX_TOAST_QUEUE,
  SocketNotificationTransport,
  notificationsAtom,
  notificationToastQueueAtom,
  showNativeNotification,
  setNativeNotificationPreference,
  type AppNotification,
  type NotificationStorageAdapter,
  type NotificationTransport,
} from "../notifications";
import { mapServerNotification } from "../plus/notificationsSync";

const makeTextElement = (opts: {
  id: string;
  text: string;
  x?: number;
  y?: number;
  containerId?: string | null;
  isDeleted?: boolean;
}): ExcalidrawTextElement =>
  ({
    id: opts.id,
    type: "text",
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: 100,
    height: 24,
    text: opts.text,
    originalText: opts.text,
    containerId: opts.containerId ?? null,
    isDeleted: opts.isDeleted ?? false,
  } as unknown as ExcalidrawTextElement);

class MemoryStorageAdapter implements NotificationStorageAdapter {
  private map = new Map<string, AppNotification[]>();
  async load(namespaceKey: string) {
    return this.map.get(namespaceKey) ?? [];
  }
  async save(namespaceKey: string, notifications: AppNotification[]) {
    this.map.set(namespaceKey, notifications);
  }
  async clear(namespaceKey: string) {
    this.map.delete(namespaceKey);
  }
}

describe("notifications core system", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    appJotaiStore.set(notificationsAtom, []);
    appJotaiStore.set(notificationToastQueueAtom, []);
  });

  describe("normalizeHandle & matchesRecipient", () => {
    it("normalizes display names and handles consistently", () => {
      expect(normalizeHandle("Alice Smith")).toBe("alice_smith");
      expect(normalizeHandle("@Bob.Dev")).toBe("bob.dev");
      expect(normalizeHandle("  @@Charlie-1  ")).toBe("charlie-1");
    });

    it("matches recipient by id, exact handle, first name, or @everyone", () => {
      const bob = {
        id: "u-bob",
        username: "Bob Builder",
        handle: "bob_builder",
      };
      const sender = { id: "u-alice", username: "Alice", handle: "alice" };

      expect(matchesRecipient({ recipientId: "u-bob", sender }, bob)).toBe(
        true,
      );
      expect(
        matchesRecipient({ recipientHandle: "bob_builder", sender }, bob),
      ).toBe(true);
      expect(matchesRecipient({ recipientHandle: "bob", sender }, bob)).toBe(
        true,
      );
      expect(
        matchesRecipient({ recipientHandle: "everyone", sender }, bob),
      ).toBe(true);
      expect(
        matchesRecipient({ recipientHandle: "everyone", sender: bob }, bob),
      ).toBe(false);
    });
  });

  describe("extractMentions", () => {
    it('extracts @handle, quoted @"Full Name", and known multi-word names while ignoring emails', () => {
      const known = [
        {
          id: "u1",
          username: "Alice Smith",
          handle: "alice_smith",
          lastSeenAt: Date.now(),
          source: "collab" as const,
        },
      ];

      const text =
        'Hey @bob and @Alice Smith, also check @"Charlie Brown" — ignore email alice@example.com!';
      const mentions = extractMentions(text, known);

      expect(mentions.map((m) => m.handle)).toEqual([
        "bob",
        "alice_smith",
        "charlie_brown",
      ]);
    });
  });

  describe("MentionTracker", () => {
    it("skips actively edited text elements and deduplicates already-notified mentions", () => {
      const tracker = new MentionTracker();
      const textEl = makeTextElement({
        id: "txt-1",
        text: "Hello @bob",
      });

      // While user is actively typing in txt-1, do not trigger notifications
      expect(
        tracker.collectNewMentions([textEl], { editingElementId: "txt-1" }),
      ).toEqual([]);

      // Once editing finishes, detect @bob once
      const firstCommit = tracker.collectNewMentions([textEl], {
        editingElementId: null,
      });
      expect(firstCommit).toHaveLength(1);
      expect(firstCommit[0].handle).toBe("bob");
      expect(firstCommit[0].elementId).toBe("txt-1");

      // Re-scanning or moving/editing unrelated words does not re-emit @bob
      const movedEl = {
        ...textEl,
        x: 250,
        text: "Hello @bob updated",
        originalText: "Hello @bob updated",
      };
      expect(tracker.collectNewMentions([movedEl])).toEqual([]);

      // Adding a new mention @carol in the same element emits only @carol
      const addedEl = {
        ...movedEl,
        text: "Hello @bob updated @carol",
        originalText: "Hello @bob updated @carol",
      };
      const secondCommit = tracker.collectNewMentions([addedEl]);
      expect(secondCommit).toHaveLength(1);
      expect(secondCommit[0].handle).toBe("carol");
    });

    it("seeds existing elements without emitting notifications", () => {
      const tracker = new MentionTracker();
      const existing = makeTextElement({
        id: "txt-seed",
        text: "Pre-existing @alice",
      });
      tracker.seedElements([existing]);
      expect(tracker.collectNewMentions([existing])).toEqual([]);
    });
  });

  describe("NotificationEngine scalability & delivery", () => {
    it("deduplicates notifications by dedupeKey and enforces bounded retention", async () => {
      const storage = new MemoryStorageAdapter();
      const engine = new NotificationEngine({
        storage,
        transports: [],
        enableDefaultTransports: false,
      });
      await engine.init();
      await engine.updateCurrentUser("Alice");

      const sender = { id: "u-bob", username: "Bob", handle: "bob" };
      const bobNote = (i: number, dedupeKey = `k-${i}`): AppNotification => ({
        id: `id-${i}`,
        type: "canvas_mention",
        title: "Mentioned on canvas",
        message: `Bob mentioned you #${i}`,
        sender,
        recipientHandle: "alice",
        createdAt: 1000 + i,
        read: i < 100,
        dedupeKey,
        priority: "normal",
        payload: {
          elementId: `el-${i}`,
          textSnippet: `note ${i}`,
        },
      });

      expect(engine.ingest(bobNote(1, "same-key"))).toBe(true);
      expect(engine.ingest(bobNote(2, "same-key"))).toBe(false);

      for (let i = 3; i <= MAX_STORED_NOTIFICATIONS + 30; i++) {
        engine.ingest(bobNote(i));
      }

      const stored = appJotaiStore.get(notificationsAtom);
      expect(stored.length).toBe(MAX_STORED_NOTIFICATIONS);
      // Toast queue stays bounded
      expect(
        appJotaiStore.get(notificationToastQueueAtom).length,
      ).toBeLessThanOrEqual(MAX_TOAST_QUEUE);

      engine.destroy();
    });

    it("dispatches share_invite and canvas_mention over registered transports", async () => {
      const sent: AppNotification[] = [];
      const mockTransport: NotificationTransport = {
        name: "mock",
        start: () => {},
        send: (n) => {
          sent.push(n);
        },
        stop: () => {},
      };

      const engine = new NotificationEngine({
        storage: new MemoryStorageAdapter(),
        transports: [mockTransport],
        enableDefaultTransports: false,
      });
      await engine.init();
      await engine.updateCurrentUser("Alice");

      await engine.addSharedUser({
        roomId: "room-123",
        roomKey: "key-abc",
        roomLink: "https://example.com/#room=room-123,key-abc",
        targetUsername: "Bob",
        role: "editor",
      });

      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe("share_invite");
      expect(sent[0].recipientHandle).toBe("bob");
      if (sent[0].type === "share_invite") {
        expect(sent[0].payload.roomId).toBe("room-123");
        expect(sent[0].payload.role).toBe("editor");
      }

      const textEl = makeTextElement({
        id: "mention-el-1",
        text: "Please review @bob",
      });

      await engine.processCanvasElements([textEl], {
        editingElementId: null,
        roomId: "room-123",
        roomLink: "https://example.com/#room=room-123,key-abc",
      });

      expect(sent).toHaveLength(2);
      expect(sent[1].type).toBe("canvas_mention");
      expect(sent[1].recipientHandle).toBe("bob");
      if (sent[1].type === "canvas_mention") {
        expect(sent[1].payload.elementId).toBe("mention-el-1");
      }

      engine.destroy();
    });

    it("queues outbound socket notifications while offline and flushes when bridge becomes ready", async () => {
      const broadcastEncrypted = vi.fn().mockResolvedValue(undefined);
      let ready = false;

      const socketTransport = new SocketNotificationTransport(() => ({
        id: "u-alice",
        username: "Alice",
        handle: "alice",
      }));

      socketTransport.setBridge({
        isReady: () => ready,
        broadcastEncrypted,
        getSocket: () => null,
      });

      const sampleNotification: AppNotification = {
        id: "n-offline-1",
        type: "share_invite",
        title: "Shared canvas invitation",
        message: "Alice invited Bob",
        sender: { id: "u-alice", username: "Alice", handle: "alice" },
        recipientHandle: "bob",
        createdAt: Date.now(),
        read: false,
        dedupeKey: "offline-1",
        priority: "high",
        payload: {
          roomId: "r1",
          roomLink: "https://example.com/#room=r1,k1",
          role: "editor",
        },
      };

      await socketTransport.send(sampleNotification);
      expect(broadcastEncrypted).not.toHaveBeenCalled();

      ready = true;
      await socketTransport.flushOutbox();
      expect(broadcastEncrypted).toHaveBeenCalledTimes(1);
      expect(broadcastEncrypted).toHaveBeenCalledWith(sampleNotification);
    });
  });

  describe("native desktop notifications & Plus server mapping", () => {
    it("pops native OS notification when document is hidden/minimized and opens in-app view on click", () => {
      const created: Array<{
        title: string;
        options: NotificationOptions;
        onclick: ((ev: Event) => void) | null;
        close: () => void;
      }> = [];

      class MockNotification {
        static permission: NotificationPermission = "granted";
        title: string;
        options: NotificationOptions;
        onclick: ((ev: Event) => void) | null = null;
        close = vi.fn();
        constructor(title: string, options: NotificationOptions = {}) {
          this.title = title;
          this.options = options;
          created.push(this);
        }
      }

      const originalNotification = (globalThis as any).Notification;
      (globalThis as any).Notification = MockNotification;
      setNativeNotificationPreference(true);

      const onActivate = vi.fn();
      const focusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});

      const note: AppNotification = {
        id: "srv-n-1",
        type: "comment_mention",
        title: "Mentioned in Architecture",
        message: 'Alice mentioned you in chat: "@Bob check this"',
        sender: { id: "u-alice", username: "Alice", handle: "alice" },
        recipientHandle: "bob",
        createdAt: Date.now(),
        read: false,
        dedupeKey: "comment-mention:c1:u-bob",
        priority: "high",
        payload: {
          sceneId: "scene-1",
          commentId: "c1",
        },
      };

      try {
        // When active/focused, native popup should not fire unless forced
        const hiddenDocActive = {
          hidden: false,
          hasFocus: () => true,
          defaultView: window,
        } as unknown as Document;
        expect(
          showNativeNotification(note, { doc: hiddenDocActive, onActivate }),
        ).toBeNull();
        expect(created).toHaveLength(0);

        // When Chrome is minimized/hidden, native popup fires and click activates callback
        const hiddenDocMinimized = {
          hidden: true,
          hasFocus: () => false,
          defaultView: window,
        } as unknown as Document;
        const nativePopup = showNativeNotification(note, {
          doc: hiddenDocMinimized,
          onActivate,
        });
        expect(nativePopup).not.toBeNull();
        expect(created).toHaveLength(1);
        expect(created[0].title).toContain("Mentioned in Architecture");

        created[0].onclick?.(new Event("click"));
        expect(focusSpy).toHaveBeenCalled();
        expect(created[0].close).toHaveBeenCalled();
        expect(onActivate).toHaveBeenCalledWith(note);
      } finally {
        (globalThis as any).Notification = originalNotification;
        focusSpy.mockRestore();
      }
    });

    it("maps server notifications for scene shares, team adds, and comment replies", () => {
      const user = {
        id: "u-bob",
        email: "bob@example.com",
        name: "Bob",
        createdAt: 1000,
        hasAIKey: false,
      };
      const mapped = mapServerNotification(
        {
          id: "n-team-1",
          userId: "u-bob",
          actor: { id: "u-alice", name: "Alice", avatarUrl: null },
          type: "team_added",
          title: "Added to team",
          message: 'Alice added you to team "Core" as member',
          sceneId: null,
          sceneName: null,
          teamId: "team-9",
          teamName: "Core",
          commentId: null,
          elementId: null,
          dedupeKey: "team:9:bob",
          payload: { role: "member" },
          read: false,
          readAt: null,
          createdAt: 2000,
        },
        user,
      );

      expect(mapped.type).toBe("team_added");
      if (mapped.type === "team_added") {
        expect(mapped.payload.teamId).toBe("team-9");
        expect(mapped.payload.role).toBe("member");
      }
    });
  });
});
