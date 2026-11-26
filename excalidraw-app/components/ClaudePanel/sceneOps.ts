import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import { newElementWith } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { BridgeOp, SceneSummary } from "./claudeBridge";

const MAX_SUMMARY_ELEMENTS = 200;

/** compact description of the canvas that is sent to Claude with each turn */
export const summarizeScene = (api: ExcalidrawImperativeAPI): SceneSummary => {
  const elements = api.getSceneElements().slice(0, MAX_SUMMARY_ELEMENTS);
  const selectedIds = Object.keys(api.getAppState().selectedElementIds);
  return {
    selectedIds,
    elements: elements
      // bound labels are folded into their container below
      .filter((el) => !(el.type === "text" && el.containerId))
      .map((el) => {
        const label = elements.find(
          (t) => t.type === "text" && t.containerId === el.id,
        ) as any;
        const text = el.type === "text" ? (el as any).text : label?.text;
        return {
          id: el.id,
          type: el.type,
          x: Math.round(el.x),
          y: Math.round(el.y),
          w: Math.round(el.width),
          h: Math.round(el.height),
          ...(text ? { text } : {}),
          ...(el.backgroundColor !== "transparent"
            ? { bg: el.backgroundColor }
            : {}),
          ...((el as any).startBinding
            ? { from: (el as any).startBinding.elementId }
            : {}),
          ...((el as any).endBinding
            ? { to: (el as any).endBinding.elementId }
            : {}),
        };
      }),
  };
};

const fitTo = (api: ExcalidrawImperativeAPI, ids: Set<string>) => {
  const targets = api
    .getSceneElements()
    .filter((el) => ids.has(el.id) || ids.has((el as any).containerId));
  if (!targets.length) {
    return;
  }
  api.setViewport({
    target: targets,
    fit: "scale-down",
    animation: { duration: 400 },
    offsets: { ui: true },
  });
};

type Box = { x: number; y: number; w: number; h: number };

/**
 * Arrows bound to shapes by id are routed from the shapes' centers, so Claude
 * doesn't have to compute coordinates (and a missing/zero x,y,width,height
 * doesn't yield an invisible arrow).
 */
const withArrowGeometry = (
  skeletons: Record<string, any>[],
  existing: readonly {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
) => {
  const boxes = new Map<string, Box>();
  for (const el of existing) {
    boxes.set(el.id, { x: el.x, y: el.y, w: el.width, h: el.height });
  }
  for (const el of skeletons) {
    if (el.id && typeof el.x === "number" && typeof el.y === "number") {
      boxes.set(el.id, {
        x: el.x,
        y: el.y,
        w: el.width ?? 100,
        h: el.height ?? 100,
      });
    }
  }
  return skeletons.map((el) => {
    if (el.type !== "arrow" && el.type !== "line") {
      return el;
    }
    const a = el.start?.id && boxes.get(el.start.id);
    const b = el.end?.id && boxes.get(el.end.id);
    if (!a || !b) {
      return el;
    }
    const [ax, ay] = [a.x + a.w / 2, a.y + a.h / 2];
    const [bx, by] = [b.x + b.w / 2, b.y + b.h / 2];
    const horizontal = Math.abs(bx - ax) >= Math.abs(by - ay);
    // leave from/arrive at the facing edges instead of the centers
    const sx = horizontal ? ax + Math.sign(bx - ax) * (a.w / 2) : ax;
    const sy = horizontal ? ay : ay + Math.sign(by - ay) * (a.h / 2);
    const ex = horizontal ? bx - Math.sign(bx - ax) * (b.w / 2) : bx;
    const ey = horizontal ? by : by - Math.sign(by - ay) * (b.h / 2);
    return {
      ...el,
      x: sx,
      y: sy,
      width: ex - sx,
      height: ey - sy,
    };
  });
};

/** applies one tool call from Claude to the canvas */
export const applyOp = (api: ExcalidrawImperativeAPI, op: BridgeOp) => {
  const existing = api.getSceneElementsIncludingDeleted();

  switch (op.op) {
    case "add": {
      const taken = new Set(existing.map((el) => el.id));
      const skeletons = op.elements.filter((el) => !el.id || !taken.has(el.id));
      if (!skeletons.length) {
        return;
      }
      const created = convertToExcalidrawElements(
        withArrowGeometry(skeletons, existing) as any,
        {
          regenerateIds: false,
        },
      );
      api.updateScene({
        elements: [...existing, ...created],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      fitTo(api, new Set(created.map((el) => el.id)));
      return;
    }
    case "update": {
      const byId = new Map(existing.map((el) => [el.id, el]));
      for (const { id, ...props } of op.updates) {
        const el = byId.get(id);
        if (el && !el.isDeleted) {
          api.mutateElement(el as any, props);
        }
      }
      api.updateScene({ captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      return;
    }
    case "delete": {
      const ids = new Set(op.ids);
      api.updateScene({
        elements: existing.map((el) =>
          ids.has(el.id) || ids.has((el as any).containerId)
            ? newElementWith(el, { isDeleted: true })
            : el,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      return;
    }
    case "clear": {
      api.updateScene({
        elements: existing.map((el) => newElementWith(el, { isDeleted: true })),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    }
  }
};
