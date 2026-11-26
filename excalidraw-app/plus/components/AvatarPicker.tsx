import clsx from "clsx";
import { useMemo, useRef, useState } from "react";

import {
  AVATAR_STYLES,
  AVATAR_THEMES,
  generateAvatarDataURL,
  getAvatarPresets,
  readImageFileAsAvatarDataURL,
} from "../avatar";

import { ErrorText, PlusAvatar, SmallButton } from "./ui";

import type { AvatarStyle } from "../avatar";

export const AvatarPicker = ({
  name,
  avatarUrl,
  disabled,
  onSave,
}: {
  name: string;
  avatarUrl: string | null;
  disabled?: boolean;
  onSave: (nextAvatarUrl: string | null) => Promise<void>;
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [style, setStyle] = useState<AvatarStyle>("bot");
  const [themeId, setThemeId] = useState<string>(AVATAR_THEMES[0].id);
  const [seed, setSeed] = useState<number>(() =>
    Math.floor(Math.random() * 100_000),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const presets = useMemo(() => getAvatarPresets(name), [name]);
  const generatedPreview = useMemo(
    () => generateAvatarDataURL({ style, themeId, seed, name }),
    [style, themeId, seed, name],
  );

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setLocalError(null);
    setProcessing(true);
    try {
      const dataURL = await readImageFileAsAvatarDataURL(
        file,
        fileInputRef.current?.ownerDocument,
      );
      await onSave(dataURL);
      setStudioOpen(false);
    } catch (error: any) {
      setLocalError(error?.message || "Couldn't upload avatar");
    } finally {
      setProcessing(false);
    }
  };

  const busy = !!disabled || processing;

  return (
    <div className="plus-avatar-picker">
      <div className="plus-avatar-picker__header">
        <PlusAvatar name={name} avatarUrl={avatarUrl} size="large" />
        <div className="plus-avatar-picker__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            hidden
            onChange={handleFileChange}
          />
          <div className="plus-row">
            <SmallButton
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {processing ? "Uploading…" : "Upload image"}
            </SmallButton>
            <SmallButton
              disabled={busy}
              onClick={() => {
                setLocalError(null);
                setStudioOpen((open) => !open);
              }}
            >
              {studioOpen ? "Close creator" : "Create avatar"}
            </SmallButton>
            {avatarUrl && (
              <SmallButton
                danger
                disabled={busy}
                onClick={() => {
                  setLocalError(null);
                  onSave(null);
                }}
              >
                Remove
              </SmallButton>
            )}
          </div>
          <span className="plus-muted">
            Shown in the top bar, live presence, comments, and @mentions.
          </span>
        </div>
      </div>

      {studioOpen && (
        <div className="plus-avatar-studio">
          <div className="plus-avatar-studio__section">
            <span className="plus-field__label">Quick pick</span>
            <div className="plus-avatar-presets">
              {presets.map((preset) => (
                <button
                  key={`${preset.style}-${preset.themeId}`}
                  type="button"
                  disabled={busy}
                  className={clsx("plus-avatar-preset", {
                    selected: avatarUrl === preset.url,
                  })}
                  title={`Select ${preset.style} avatar`}
                  aria-label={`Select ${preset.style} ${preset.themeId} avatar`}
                  onClick={() => {
                    setStyle(preset.style);
                    setThemeId(preset.themeId);
                    setSeed(preset.seed);
                    onSave(preset.url);
                  }}
                >
                  <img src={preset.url} alt="" />
                </button>
              ))}
            </div>
          </div>

          <div className="plus-avatar-studio__builder">
            <div className="plus-avatar-studio__preview">
              <PlusAvatar
                name={name}
                avatarUrl={generatedPreview}
                size="large"
              />
              <SmallButton
                disabled={busy}
                onClick={() => setSeed((s) => (s * 1664525 + 1013904223) >>> 0)}
              >
                Shuffle
              </SmallButton>
              <SmallButton
                disabled={busy}
                className="primary"
                onClick={() => onSave(generatedPreview)}
              >
                Use avatar
              </SmallButton>
            </div>

            <div className="plus-avatar-studio__controls">
              <div className="plus-avatar-studio__group">
                <span className="plus-muted">Style</span>
                <div className="plus-row">
                  {AVATAR_STYLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={clsx("plus-chip", {
                        active: style === item.id,
                      })}
                      onClick={() => setStyle(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="plus-avatar-studio__group">
                <span className="plus-muted">Theme</span>
                <div className="plus-row">
                  {AVATAR_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={clsx("plus-color-swatch", {
                        active: themeId === theme.id,
                      })}
                      style={{
                        background: `linear-gradient(135deg, ${theme.bg1}, ${theme.bg2})`,
                      }}
                      title={theme.label}
                      aria-label={`${theme.label} theme`}
                      onClick={() => setThemeId(theme.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ErrorText error={localError} />
    </div>
  );
};
