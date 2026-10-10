"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  type WorkspaceTab,
  workspacePaths,
} from "@/components/layout/navigation";
import { WorkspaceIcon } from "@/components/layout/WorkspaceIcon";

type NavigationItem = {
  id: WorkspaceTab;
  label: string;
  icon: Parameters<typeof WorkspaceIcon>[0]["name"];
};

export function WorkspaceSidebar({
  items,
  active,
  locale,
  preview,
  languageLabel,
  onLocale,
  onNavigate,
  onOpenPrivacy,
  onOpenEngines,
  busy = false,
}: {
  busy?: boolean;
  items: NavigationItem[];
  active: WorkspaceTab;
  locale: "en" | "ne" | "tam";
  preview: string;
  languageLabel: string;
  onLocale: (locale: "en" | "ne" | "tam") => void;
  onNavigate: (target: WorkspaceTab) => boolean;
  onOpenPrivacy?: () => void;
  onOpenEngines?: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const ne = locale === "ne";

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 900px)");
    const resized = () => {
      if (!mobile.matches) setDrawerOpen(false);
    };
    mobile.addEventListener("change", resized);
    return () => mobile.removeEventListener("change", resized);
  }, []);
  useEffect(() => {
    const dialog = drawer.current;
    if (!drawerOpen) {
      dialog?.close();
      return;
    }
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  function navigate(target: WorkspaceTab) {
    if (busy || !onNavigate(target)) return false;
    drawer.current?.close();
    setDrawerOpen(false);
    return true;
  }
  function keepFocusInDrawer(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button:not([disabled]), select:not([disabled]), a[href], input:not([disabled])",
      ),
    ).filter((control) => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  const brand = (
    <Link
      href={workspacePaths.dashboard}
      className="brand"
      aria-label={ne ? "ArogyaAI ड्यासबोर्ड" : "ArogyaAI home"}
      onNavigate={(event) => {
        if (!navigate("dashboard")) event.preventDefault();
      }}
    >
      <span className="brand-icon" aria-hidden="true">
        +
      </span>
      Arogya<span>AI</span>
    </Link>
  );
  function contents() {
    return (
      <>
        <header className="sidebar-brand">
          {brand}
          <span className="sidebar-preview">{preview}</span>
        </header>
        <nav
          className="workspace-navigation"
          aria-label={ne ? "मुख्य मेनु" : "Main navigation"}
        >
          {items.map((item) => (
            <Link
              href={workspacePaths[item.id]}
              key={item.id}
              onNavigate={(event) => {
                if (!navigate(item.id)) event.preventDefault();
              }}
              aria-current={active === item.id ? "page" : undefined}
              className={active === item.id ? "navigation-active" : ""}
            >
              <WorkspaceIcon name={item.icon} size={19} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer-controls">
          <label className="sidebar-language">
            {languageLabel}
            <select
              disabled={busy}
              value={locale}
              onChange={(event) =>
                onLocale(event.target.value as typeof locale)
              }
            >
              <option value="en">English</option>
              <option value="ne">नेपाली</option>
              <option value="tam">Tamang · English preview</option>
            </select>
          </label>
          <div className="sidebar-utilities">
            {onOpenPrivacy && (
              <button
                type="button"
                className="sidebar-utility-link"
                onClick={() => {
                  drawer.current?.close();
                  setDrawerOpen(false);
                  onOpenPrivacy();
                }}
              >
                <WorkspaceIcon name="privacy" size={16} />
                <span>{ne ? "गोपनीयता" : "Privacy & Data"}</span>
              </button>
            )}
            {onOpenEngines && (
              <button
                type="button"
                className="sidebar-utility-link"
                onClick={() => {
                  drawer.current?.close();
                  setDrawerOpen(false);
                  onOpenEngines();
                }}
              >
                <WorkspaceIcon name="engines" size={16} />
                <span>{ne ? "औजार तथा मोडेल" : "Tools & models"}</span>
              </button>
            )}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <aside
        className="workspace-sidebar"
        aria-label={ne ? "कार्यस्थान मेनु" : "Workspace sidebar"}
      >
        {contents()}
      </aside>
      <header className="mobile-workspace-header">
        {brand}
        <button
          type="button"
          className="sidebar-menu-button"
          aria-controls="workspace-drawer"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <WorkspaceIcon name="menu" size={20} />
          {ne ? "मेनु" : "Menu"}
        </button>
      </header>
      <dialog
        ref={drawer}
        id="workspace-drawer"
        className="workspace-drawer"
        aria-labelledby="workspace-drawer-title"
        onClose={() => setDrawerOpen(false)}
        onKeyDown={keepFocusInDrawer}
      >
        <div className="drawer-heading">
          <h2 id="workspace-drawer-title">
            {ne ? "कार्यस्थान मेनु" : "Your workspace"}
          </h2>
          <button
            type="button"
            className="sidebar-close-button"
            onClick={() => drawer.current?.close()}
            aria-label={ne ? "मेनु बन्द गर्नुहोस्" : "Close navigation"}
          >
            ×
          </button>
        </div>
        {contents()}
      </dialog>
    </>
  );
}
