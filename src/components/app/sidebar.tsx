"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/ui/icon";
import { useSession } from "@/components/providers/session-provider";
import { SelloLogo } from "@/components/app/sello-logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { prefetchBillingUsage } from "@/components/billing/usage-snapshot";
import { useMobileNav } from "@/components/providers/mobile-nav-provider";

type NavItem = { href: string; label: string; icon: IconName };

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, token, signOut, name, requestNameEdit } = useSession();
  const { open: drawerOpen, close: closeDrawer } = useMobileNav();
  const [search, setSearch] = useState("");
  const isActive = (href: string) =>
    href === "/inventory"
      ? pathname.startsWith("/inventory") && !pathname.startsWith("/inventory/bulk")
      : href === "/channels"
        ? pathname === "/channels" || pathname.startsWith("/settings/marketplaces")
      : href === "/settings"
        ? pathname === "/settings"
      : pathname === href || pathname.startsWith(href + "/");

  const primary: NavItem[] = [
    { href: "/inventory", label: "Inventory", icon: "box" },
    { href: "/inventory/bulk", label: "Bulk intake", icon: "upload" },
    { href: "/history", label: "Publish history", icon: "history" },
    { href: "/channels", label: "Marketplaces", icon: "store" },
  ];
  const config: NavItem[] = [
    { href: "/dashboard", label: "Overview", icon: "grid" },
    { href: "/settings/billing", label: "Billing", icon: "tag" },
    { href: "/settings", label: "Settings", icon: "settings" },
    { href: "/feedback", label: "Send feedback", icon: "send" },
  ];

  const email = session.user.email ?? "you";
  const initials = (name || email).slice(0, 2).toUpperCase();

  function warm(href: string) {
    router.prefetch?.(href);
    if (href === "/settings/billing") prefetchBillingUsage(token);
  }

  function go(href: string) {
    warm(href);
    closeDrawer();
    router.push(href);
  }

  return (
    <aside id="seller-navigation" aria-label="Seller workspace" className={`sidebar${drawerOpen ? " sidebar--open" : ""}`}>
      <div className="sidebar__brand">
        <button
          type="button"
          className="sidebar__brand-mark"
          onClick={() => go("/inventory")}
          aria-label="Sello — go to inventory"
          title="Go to inventory"
        >
          <SelloLogo />
        </button>
      </div>

      <button className="nav-new" onClick={() => go("/inventory/new")}>
        <Icon name="plus" size={15} />
        New listing

      </button>

      <form
        className="input-search"
        style={{ minWidth: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          go(`/inventory?q=${encodeURIComponent(search)}`);
        }}
      >
        <Icon name="search" size={14} />
        <input
          aria-label="Find inventory item"
          placeholder="Find item, SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <nav className="sidebar__section" aria-label="Selling">
        {primary.map((it) => (
          <button
            key={it.href}
            aria-current={isActive(it.href) ? "page" : undefined}
            className={`nav-item ${isActive(it.href) ? "nav-item--active" : ""}`}
            onFocus={() => warm(it.href)}
            onPointerEnter={() => warm(it.href)}
            onClick={() => go(it.href)}
          >
            <Icon className="nav-item__icon" name={it.icon} size={15} />
            {it.label}
          </button>
        ))}
      </nav>

      <nav className="sidebar__section" aria-label="Workspace">
        {config.map((it) => (
          <button
            key={it.href}
            aria-current={isActive(it.href) ? "page" : undefined}
            className={`nav-item ${isActive(it.href) ? "nav-item--active" : ""}`}
            onFocus={() => warm(it.href)}
            onPointerEnter={() => warm(it.href)}
            onClick={() => go(it.href)}
          >
            <Icon className="nav-item__icon" name={it.icon} size={15} />
            {it.label}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="avatar">{initials}</div>
        <button
          type="button"
          onClick={requestNameEdit}
          title="Edit your name"
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name || email}
          </div>
          <div className="t-small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {email}
          </div>
        </button>
        </div>
      <div className="sidebar__utilities"><ThemeToggle />
        <button className="btn btn--ghost btn--icon btn--sm" aria-label="Sign out" title="Sign out" onClick={() => signOut()}>
          <Icon name="logout" size={14} />
        </button>
      </div>
    </aside>
  );
}
