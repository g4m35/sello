"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type MobileNavCtx = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const MobileNavContext = createContext<MobileNavCtx>({
  open: false,
  toggle: () => undefined,
  close: () => undefined,
});

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

  // Keep the mobile drawer a contained keyboard surface; restore the trigger on close.
  useEffect(() => {
    if (!open) return;
    const sidebar = document.getElementById("seller-navigation");
    if (!sidebar) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const main = document.querySelector<HTMLElement>(".app > .main");
    const previousInert = main?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (main) main.inert = true;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(sidebar.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]')).filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key !== "Tab") return;
      const stops = focusable();
      const first = stops[0], last = stops[stops.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || !sidebar?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    const media = window.matchMedia("(min-width: 761px)");
    const onResize = () => { if (media.matches) close(); };
    media.addEventListener("change", onResize);
    document.addEventListener("keydown", handleKey);
    return () => {
      if (main) main.inert = previousInert;
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKey);
      media.removeEventListener("change", onResize);
      previous?.focus();
    };
  }, [open, close]);

  return (
    <MobileNavContext.Provider value={{ open, toggle, close }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}
