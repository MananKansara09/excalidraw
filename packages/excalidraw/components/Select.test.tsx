import { render as renderStandalone } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { fireEvent, render, screen, waitFor } from "../tests/test-utils";

import { Dialog } from "./Dialog";
import { Select } from "./Select";

// Radix Select uses pointer capture / scrollIntoView APIs that jsdom omits.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

describe("<Select />", () => {
  it("renders selected option and updates value on click", async () => {
    const onChange = vi.fn();

    const { container } = renderStandalone(
      <div className="excalidraw">
        <Select
          label="Access level"
          value="editor"
          options={[
            { value: "editor", label: "Can edit" },
            { value: "viewer", label: "Can view" },
          ]}
          onChange={onChange}
        />
      </div>,
    );

    const trigger = screen.getByRole("combobox", { name: "Access level" });
    expect(trigger).toHaveTextContent("Can edit");

    fireEvent.click(trigger);

    const option = await screen.findByRole("option", { name: "Can view" });
    expect(option.closest(".excalidraw")).toBe(
      container.querySelector(".excalidraw"),
    );

    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("viewer");
  });

  it("supports empty string option values", async () => {
    const Controlled = () => {
      const [val, setVal] = useState("");
      return (
        <div className="excalidraw">
          <Select
            label="Workspace"
            value={val}
            options={[
              { value: "", label: "My scenes" },
              { value: "team-1", label: "Design" },
            ]}
            onChange={setVal}
          />
        </div>
      );
    };

    renderStandalone(<Controlled />);

    const trigger = screen.getByRole("combobox", { name: "Workspace" });
    expect(trigger).toHaveTextContent("My scenes");

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Design" }));
    expect(trigger).toHaveTextContent("Design");

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "My scenes" }));
    expect(trigger).toHaveTextContent("My scenes");
  });

  it("closes only the select menu on Escape when inside a Dialog", async () => {
    const onCloseRequest = vi.fn();

    await render(
      <Excalidraw>
        <Dialog title="Share" onCloseRequest={onCloseRequest}>
          <Select
            label="Role"
            value="editor"
            options={[
              { value: "editor", label: "Can edit" },
              { value: "viewer", label: "Can view" },
            ]}
            onChange={() => {}}
          />
        </Dialog>
      </Excalidraw>,
    );

    const trigger = screen.getByRole("combobox", { name: "Role" });
    fireEvent.click(trigger);

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();

    fireEvent.keyDown(listbox, { key: KEYS.ESCAPE });

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    expect(onCloseRequest).not.toHaveBeenCalled();
  });
});
