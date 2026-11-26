import clsx from "clsx";
import { Select as SelectPrimitive } from "radix-ui";
import { useMemo, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { chevronDownIcon, tablerCheckIcon } from "./icons";

import "./Select.scss";

const EMPTY_VALUE = "__excalidraw_select_empty__";

const encodeValue = (value: string) => (value === "" ? EMPTY_VALUE : value);
const decodeValue = (value: string) => (value === EMPTY_VALUE ? "" : value);

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
  "data-testid"?: string;
}

/**
 * Excalidraw design-system select control backed by Radix Select.
 * Portals into the nearest `.excalidraw` container so theme tokens and
 * modal stacking order apply consistently.
 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  placeholder,
  className,
  align = "start",
  "data-testid": testId,
}: SelectProps<T>) => {
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const portalContainer = useMemo(
    () => triggerEl?.closest<HTMLElement>(".excalidraw") ?? undefined,
    [triggerEl],
  );

  return (
    <SelectPrimitive.Root
      value={encodeValue(value)}
      onValueChange={(nextValue) => onChange(decodeValue(nextValue) as T)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        ref={setTriggerEl}
        type="button"
        className={clsx("ExcSelect__trigger", className)}
        aria-label={label}
        data-testid={testId}
      >
        <span className="ExcSelect__value">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon className="ExcSelect__icon" aria-hidden="true">
          {chevronDownIcon}
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalContainer}>
        <SelectPrimitive.Content
          className="ExcSelect__content"
          position="popper"
          sideOffset={6}
          align={align}
          collisionPadding={8}
          onKeyDown={(event) => {
            // Prevent Escape from bubbling through React's portal tree to
            // parent Dialog/Modal handlers while closing only the select menu.
            if (event.key === KEYS.ESCAPE) {
              event.stopPropagation();
            }
          }}
        >
          <SelectPrimitive.Viewport className="ExcSelect__viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={encodeValue(option.value)}
                disabled={option.disabled}
                className="ExcSelect__item"
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ExcSelect__itemIndicator">
                  {tablerCheckIcon}
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
};
