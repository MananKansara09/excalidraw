import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FormEvent, ReactNode } from "react";

/** A centered in-page dialog. Closes on Escape and on a click outside. */
export const Modal = ({
  title,
  children,
  onClose,
  width = 26,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** in rem */
  width?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // focus the first field, or else the dialog itself
    const field = ref.current?.querySelector<HTMLElement>(
      "input, select, textarea",
    );
    (field ?? ref.current)?.focus();
    if (field instanceof HTMLInputElement) {
      field.select();
    }
    return () => previouslyFocused?.focus?.();
  }, []);

  return (
    <div
      className="dash-modal__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={ref}
        className="dash-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ maxWidth: `${width}rem` }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          // keep Tab inside the dialog
          if (event.key === "Tab") {
            const focusable = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                "input, select, textarea, button:not(:disabled)",
              ),
            );
            if (!focusable.length) {
              return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 className="dash-modal__title">{title}</h2>
        {children}
      </div>
    </div>
  );
};

/** A modal wrapping a form: Enter submits, the footer has Cancel + submit. */
export const FormModal = ({
  title,
  submitLabel,
  danger,
  disabled,
  pending,
  error,
  onSubmit,
  onClose,
  children,
  width,
}: {
  title: string;
  submitLabel: string;
  danger?: boolean;
  disabled?: boolean;
  pending?: boolean;
  error?: string | null;
  onSubmit: () => void;
  onClose: () => void;
  children?: ReactNode;
  width?: number;
}) => (
  <Modal title={title} onClose={onClose} width={width}>
    <form
      className="dash-modal__form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!disabled && !pending) {
          onSubmit();
        }
      }}
    >
      {children}
      {error && (
        <div className="dash-error" role="alert">
          {error}
        </div>
      )}
      <div className="dash-modal__footer">
        <button type="button" className="dash-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className={`dash-btn ${
            danger ? "dash-btn--danger" : "dash-btn--primary"
          }`}
          disabled={disabled || pending}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  </Modal>
);

export type PromptOptions = {
  title: string;
  label?: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
};

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  submitLabel?: string;
  danger?: boolean;
};

type ModalContextValue = {
  /** Resolves to the entered text, or `null` when cancelled. */
  prompt: (options: PromptOptions) => Promise<string | null>;
  /** Resolves to whether the user confirmed. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ModalContext = createContext<ModalContextValue | null>(null);

type Active =
  | {
      kind: "prompt";
      options: PromptOptions;
      resolve: (value: string | null) => void;
    }
  | {
      kind: "confirm";
      options: ConfirmOptions;
      resolve: (value: boolean) => void;
    };

const PromptModal = ({
  options,
  onDone,
}: {
  options: PromptOptions;
  onDone: (value: string | null) => void;
}) => {
  const [value, setValue] = useState(options.initialValue ?? "");
  return (
    <FormModal
      title={options.title}
      submitLabel={options.submitLabel ?? "Save"}
      disabled={!value.trim()}
      onSubmit={() => onDone(value.trim())}
      onClose={() => onDone(null)}
    >
      {options.description && (
        <p className="dash-modal__text">{options.description}</p>
      )}
      <label className="dash-field">
        {options.label && (
          <span className="dash-field__label">{options.label}</span>
        )}
        <input
          className="dash-input"
          value={value}
          placeholder={options.placeholder}
          maxLength={120}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
    </FormModal>
  );
};

/** Provides `useModal()`: promise-based replacements for prompt and confirm. */
export const ModalProvider = ({ children }: { children: ReactNode }) => {
  const [active, setActive] = useState<Active | null>(null);

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) =>
        setActive({ kind: "prompt", options, resolve }),
      ),
    [],
  );
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setActive({ kind: "confirm", options, resolve }),
      ),
    [],
  );
  const value = useMemo(() => ({ prompt, confirm }), [prompt, confirm]);

  const finish = (result: string | null | boolean) => {
    (
      active?.resolve as ((value: string | null | boolean) => void) | undefined
    )?.(result);
    setActive(null);
  };

  return (
    <ModalContext.Provider value={value}>
      {children}
      {active?.kind === "prompt" && (
        <PromptModal options={active.options} onDone={finish} />
      )}
      {active?.kind === "confirm" && (
        <FormModal
          title={active.options.title}
          submitLabel={active.options.submitLabel ?? "Confirm"}
          danger={active.options.danger}
          onSubmit={() => finish(true)}
          onClose={() => finish(false)}
        >
          <p className="dash-modal__text">{active.options.message}</p>
        </FormModal>
      )}
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used inside <ModalProvider>");
  }
  return context;
};
