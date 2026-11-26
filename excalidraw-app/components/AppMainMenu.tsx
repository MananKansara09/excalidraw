import {
  loginIcon,
  ExcalLogo,
  eyeIcon,
  ExportIcon,
  presentationIcon,
  share,
} from "@excalidraw/excalidraw/components/icons";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { useAtomValue, useSetAtom } from "../app-jotai";
import { LanguageList } from "../app-language/LanguageList";
import { goToSignIn } from "../plus/auth";
import {
  cloudSceneAtom,
  plusDialogAtom,
  plusUserAtom,
  presentationAtom,
} from "../plus/state";

import { saveDebugState } from "./DebugCanvas";

export const AppMainMenu: React.FC<{
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  theme: Theme | "system";
  refresh: () => void;
}> = React.memo((props) => {
  const { t } = useI18n();
  const user = useAtomValue(plusUserAtom);
  const cloudScene = useAtomValue(cloudSceneAtom);
  const setDialog = useSetAtom(plusDialogAtom);
  const setPresentation = useSetAtom(presentationAtom);
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      {props.isCollabEnabled && (
        <MainMenu.DefaultItems.LiveCollaborationTrigger
          isCollaborating={props.isCollaborating}
          onSelect={() => props.onCollabDialogOpen()}
        />
      )}
      <MainMenu.Item
        icon={ExportIcon}
        onSelect={() => setDialog({ name: "export-frames" })}
      >
        Export frames (PDF / PPTX)
      </MainMenu.Item>
      <MainMenu.Item
        icon={presentationIcon}
        onSelect={() => setPresentation({ active: true, index: 0 })}
      >
        Present frames
      </MainMenu.Item>
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      {user && (
        <MainMenu.Item
          icon={ExcalLogo}
          onSelect={() => setDialog({ name: "workspace" })}
        >
          Workspace
        </MainMenu.Item>
      )}
      {user && !cloudScene && (
        <MainMenu.Item
          icon={share}
          onSelect={() => setDialog({ name: "save-to-cloud" })}
        >
          Save to workspace
        </MainMenu.Item>
      )}
      {cloudScene && !cloudScene.embed && (
        <MainMenu.Item
          icon={ExcalLogo}
          onSelect={() => {
            window.location.hash = "";
          }}
        >
          Back to local canvas
        </MainMenu.Item>
      )}
      {user ? (
        <MainMenu.Item
          icon={loginIcon}
          onSelect={() => setDialog({ name: "account" })}
        >
          Account ({user.name})
        </MainMenu.Item>
      ) : (
        <MainMenu.Item
          icon={loginIcon}
          className="highlighted"
          onSelect={() => goToSignIn()}
        >
          {t("labels.signIn")} / {t("labels.signUp")}
        </MainMenu.Item>
      )}
      {isDevEnv() && (
        <MainMenu.Item
          icon={eyeIcon}
          onSelect={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          Visual Debug
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Preferences />
      <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={props.theme} />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
});
