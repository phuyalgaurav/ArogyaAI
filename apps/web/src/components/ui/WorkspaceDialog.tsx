"use client";
import { type ReactNode, useEffect, useRef } from "react";

export function WorkspaceDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog"
      onCancel={onClose}
      aria-label={title}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="btn-modal-close"
          onClick={onClose}
          aria-label={
            document.documentElement.lang === "ne"
              ? "बन्द गर्नुहोस्"
              : "Close dialog"
          }
        >
          ×
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
