import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import ExcalidrawApp from "../App";
import { cloudSession } from "../plus/cloud";

const { h } = window;

/**
 * Collaborators on a shared scene only see each other's edits if every local
 * change in the editor reaches the cloud session, which pushes it to the
 * server. This guards that wiring: the app once stopped calling it while
 * adding unrelated features, and shared scenes silently drifted apart.
 */
describe("cloud scene sync wiring", () => {
  it("hands every local editor change to the cloud session", async () => {
    const onLocalChange = vi.spyOn(cloudSession, "onLocalChange");
    await render(<ExcalidrawApp />);
    onLocalChange.mockClear();

    const rect = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    });
    act(() => {
      API.updateScene({ elements: [rect] });
    });

    await waitFor(() => {
      expect(onLocalChange).toHaveBeenCalled();
    });
    const [elements] = onLocalChange.mock.calls.at(-1)!;
    expect(elements.some((element) => element.id === rect.id)).toBe(true);
    expect(h.elements.length).toBe(1);
  });
});
