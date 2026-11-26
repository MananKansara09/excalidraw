import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { appJotaiStore, Provider } from "../app-jotai";
import {
  notificationCenterOpenAtom,
  notificationEngine,
  notificationsAtom,
  notificationToastQueueAtom,
  type AppNotification,
} from "../notifications";
import { NotificationBell } from "../notifications/components/NotificationBell";
import { NotificationToastStack } from "../notifications/components/NotificationToast";

describe("Notification UI components", () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    appJotaiStore.set(notificationsAtom, []);
    appJotaiStore.set(notificationToastQueueAtom, []);
    appJotaiStore.set(notificationCenterOpenAtom, false);
    await notificationEngine.init();
    await notificationEngine.updateCurrentUser("Alice");
  });

  it("renders unread badge, opens notification center, marks read, and jumps on click", async () => {
    const onSelectNotification = vi.fn();

    render(
      <Provider store={appJotaiStore}>
        <div className="excalidraw">
          <NotificationBell onSelectNotification={onSelectNotification} />
          <NotificationToastStack onSelectNotification={onSelectNotification} />
        </div>
      </Provider>,
    );

    const incoming: AppNotification = {
      id: "ntf-ui-1",
      type: "canvas_mention",
      title: "Mentioned on canvas",
      message: 'Bob mentioned you: "Check @alice box"',
      sender: { id: "u-bob", username: "Bob", handle: "bob" },
      recipientHandle: "alice",
      createdAt: Date.now(),
      read: false,
      dedupeKey: "ui-mention-1",
      priority: "normal",
      payload: {
        elementId: "el-42",
        textSnippet: "Check @alice box",
      },
    };

    act(() => {
      notificationEngine.ingest(incoming);
    });

    await waitFor(() => {
      expect(screen.getByTestId("notification-unread-badge")).toHaveTextContent(
        "1",
      );
      expect(
        screen.getByTestId(`notification-toast-${incoming.id}`),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("notification-bell-button"));
    expect(screen.getByTestId("notification-center")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Jump to mention" }));
    expect(onSelectNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ntf-ui-1" }),
    );
    expect(
      screen.queryByTestId("notification-unread-badge"),
    ).not.toBeInTheDocument();
  });

  it("filters team/share notifications and renders desktop alert prompt when permission is default", () => {
    const onSelectNotification = vi.fn();

    render(
      <Provider store={appJotaiStore}>
        <div className="excalidraw">
          <NotificationBell onSelectNotification={onSelectNotification} />
        </div>
      </Provider>,
    );

    act(() => {
      notificationEngine.ingest({
        id: "ntf-team-ui",
        type: "team_added",
        title: "Added to team",
        message: 'Bob added you to team "Design"',
        sender: { id: "u-bob", username: "Bob", handle: "bob" },
        recipientHandle: "alice",
        createdAt: Date.now(),
        read: false,
        dedupeKey: "ui-team-1",
        priority: "high",
        payload: { teamId: "team-1", teamName: "Design", role: "member" },
      });
    });

    fireEvent.click(screen.getByTestId("notification-bell-button"));
    fireEvent.click(screen.getByRole("tab", { name: "Teams" }));
    expect(
      screen.getByText('Bob added you to team "Design"'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open team" }));
    expect(onSelectNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ntf-team-ui", type: "team_added" }),
    );
  });
});
