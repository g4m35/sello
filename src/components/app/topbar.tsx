"use client";

import { Fragment, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { useMobileNav } from "@/components/providers/mobile-nav-provider";

export function Topbar({ crumbs = [], right }: { crumbs?: string[]; right?: ReactNode }) {
  const { toggle } = useMobileNav();

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar__hamburger btn btn--ghost btn--icon btn--sm"
        aria-label="Toggle navigation"
        onClick={toggle}
      >
        <Icon name="menu" size={17} />
      </button>
      <div className="topbar__crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <Icon name="chevR" size={13} />}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
          </Fragment>
        ))}
      </div>
      <div className="topbar__actions">{right}</div>
    </header>
  );
}
