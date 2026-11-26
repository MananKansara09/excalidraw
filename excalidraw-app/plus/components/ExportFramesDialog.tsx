import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useMemo, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useSetAtom } from "../../app-jotai";
import { plusDialogAtom } from "../state";
import { getFrameName, getOrderedFrames, renderFrames } from "../export/frames";
import { createPdf } from "../export/pdf";
import { createPptx } from "../export/pptx";

import { ErrorText } from "./ui";
import { usePresentationOrder } from "./Presentation";

const download = (bytes: Uint8Array, filename: string, type: string) => {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const safeFilename = (name: string) =>
  name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Excalidraw";

export const ExportFramesDialog = ({
  api,
}: {
  api: ExcalidrawImperativeAPI;
}) => {
  const setDialog = useSetAtom(plusDialogAtom);
  const [order] = usePresentationOrder();
  const frames = useMemo(
    () => getOrderedFrames(api.getSceneElements(), order),
    [api, order],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(frames.map((frame) => frame.id)),
  );
  const [dark, setDark] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportAs = async (format: "pdf" | "pptx") => {
    const chosen = frames.filter((frame) => selected.has(frame.id));
    if (!chosen.length) {
      setError("Pick at least one frame");
      return;
    }
    setError(null);
    try {
      const appState = api.getAppState();
      const rendered = await renderFrames({
        frames: chosen,
        elements: api.getSceneElements(),
        files: api.getFiles(),
        appState,
        dark,
        onProgress: (done, total) =>
          setProgress(`Rendering ${done} / ${total}…`),
      });
      const name = safeFilename(api.getName() || "Excalidraw");
      if (format === "pdf") {
        download(createPdf(rendered, name), `${name}.pdf`, "application/pdf");
      } else {
        download(
          createPptx(
            rendered.map((slide, index) => ({
              ...slide,
              title: getFrameName(slide.frame, frames.indexOf(chosen[index])),
            })),
            {
              title: name,
              background: dark ? "#121212" : appState.viewBackgroundColor,
            },
          ),
          `${name}.pptx`,
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        );
      }
      setDialog(null);
    } catch (err: any) {
      setError(err?.message || "Export failed");
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog
      size="small"
      onCloseRequest={() => setDialog(null)}
      title="Export frames"
      className="plus-dialog"
    >
      {!frames.length ? (
        <p>
          This scene has no frames. Draw frames with the frame tool (F); each
          frame becomes a page or slide.
        </p>
      ) : (
        <div className="plus-panel">
          <p className="plus-muted">
            Each frame becomes a page (PDF) or a slide (PowerPoint), in
            presentation order.
          </p>
          <ul className="plus-check-list">
            {frames.map((frame, index) => (
              <li key={frame.id}>
                <label className="plus-checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(frame.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) {
                        next.add(frame.id);
                      } else {
                        next.delete(frame.id);
                      }
                      setSelected(next);
                    }}
                  />
                  {index + 1}. {getFrameName(frame, index)}
                </label>
              </li>
            ))}
          </ul>
          <label className="plus-checkbox">
            <input
              type="checkbox"
              checked={dark}
              onChange={(event) => setDark(event.target.checked)}
            />
            Dark theme
          </label>
          <ErrorText error={error} />
          {progress && <p className="plus-muted">{progress}</p>}
          <div className="plus-row">
            <FilledButton
              label="Export .pdf"
              status={progress ? "loading" : null}
              onClick={() => exportAs("pdf")}
            />
            <FilledButton
              variant="outlined"
              label="Export .pptx"
              status={progress ? "loading" : null}
              onClick={() => exportAs("pptx")}
            />
          </div>
        </div>
      )}
    </Dialog>
  );
};
