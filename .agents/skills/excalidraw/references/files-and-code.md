# Excalidraw files and code

## From code

The skeleton format is an input to `convertToExcalidrawElements`, which fills in every other element property:

```ts
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

const elements = convertToExcalidrawElements(skeletons, {
  regenerateIds: false,
});
excalidrawAPI.updateScene({ elements });
```

## `.excalidraw` files

A JSON document:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

- `elements` holds full elements, not skeletons. Prefer generating them with `convertToExcalidrawElements` over writing them by hand.
- A label is a separate text element: its `containerId` names the shape, and the shape lists it in `boundElements`.
- A bound arrow has `startBinding` / `endBinding`, and both shapes list the arrow in `boundElements`. Keep both sides consistent.
- Font families: `5` Excalifont (hand drawn), `6` Nunito, `8` Comic Shanns (code).
