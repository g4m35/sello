"use client";

import { useMobileNav } from "@/components/providers/mobile-nav-provider";

export function MobileDrawerOverlay() {
  const { open, close } = useMobileNav();
  if (!open) return null;
  return (
    <div
      className="drawer-overlay"
      aria-hidden="true"
      onClick={close}
    />
  );
}
