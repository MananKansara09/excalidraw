import React from "react";

import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";
import { getFrame } from "@excalidraw/common";
import { useI18n } from "@excalidraw/excalidraw/i18n";

import { useAtomValue } from "../app-jotai";
import { cloudSceneAtom } from "../plus/state";

/** Export dialog card that saves the canvas to the workspace. */
export const ExportToExcalidrawPlus: React.FC<{
  onSelect: () => void;
}> = ({ onSelect }) => {
  const { t } = useI18n();
  const cloudScene = useAtomValue(cloudSceneAtom);

  // already saved to the workspace
  if (cloudScene) {
    return null;
  }

  return (
    <Card color="primary">
      <div className="Card-icon">
        <ExcalidrawLogo
          style={{
            [`--color-logo-icon` as any]: "#fff",
            width: "2.8rem",
            height: "2.8rem",
          }}
        />
      </div>
      <h2>Excalidraw+</h2>
      <div className="Card-details">
        {t("exportDialog.excalidrawplus_description")}
      </div>
      <IconButton
        className="Card-button"
        type="button"
        title={t("exportDialog.excalidrawplus_button")}
        aria-label={t("exportDialog.excalidrawplus_button")}
        showAriaLabel={true}
        onClick={() => {
          trackEvent("export", "eplus", `ui (${getFrame()})`);
          onSelect();
        }}
      />
    </Card>
  );
};
