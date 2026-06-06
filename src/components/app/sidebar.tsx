"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/ui/icon";
import { api } from "@/lib/api/client";
import { useSession } from "@/components/providers/session-provider";

type NavItem = { href: string; label: string; icon: IconName; count?: number };

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, token, signOut } = useSession();
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<{ items?: number; channels?: number }>({});

  useEffect(() => {
    let active = true;
    Promise.all([api.listItems(token), api.getChannels(token)])
      .then(([items, channels]) => {
        if (active) setCounts({ items: items.items.length, channels: channels.length });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [token]);

  const isActive = (href: string) =>
    href === "/inventory"
      ? pathname.startsWith("/inventory")
      : pathname === href || pathname.startsWith(href + "/");

  const primary: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "grid" },
    { href: "/inventory", label: "Inventory", icon: "box", count: counts.items },
  ];
  const config: NavItem[] = [
    { href: "/history", label: "Publish history", icon: "history" },
    { href: "/channels", label: "Marketplaces", icon: "store", count: counts.channels },
  ];

  const email = session.user.email ?? "you";
  const initials = email.slice(0, 2).toUpperCase();

  function go(href: string) {
    router.push(href);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark">
          Counter<em>.</em>
        </span>
        <span className="sidebar__brand-tag">v0.4</span>
      </div>

      <button className="nav-new" onClick={() => go("/inventory/new")}>
        <Icon name="plus" size={15} />
        New listing
        <span className="nav-new__kbd">C</span>
      </button>

      <form
        className="input-search"
        style={{ minWidth: 0, height: 32, margin: "0 4px" }}
        onSubmit={(e) => {
          e.preventDefault();
          go(`/inventory?q=${encodeURIComponent(search)}`);
        }}
      >
        <Icon name="search" size={14} />
        <input
          placeholder="Find item, SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <div className="sidebar__section">
        {primary.map((it) => (
          <button
            key={it.href}
            className={`nav-item ${isActive(it.href) ? "nav-item--active" : ""}`}
            onClick={() => go(it.href)}
          >
            <Icon className="nav-item__icon" name={it.icon} size={15} />
            {it.label}
            {it.count != null && <span className="nav-item__count t-num">{it.count}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar__section">
        <div className="sidebar__label">Workspace</div>
        {config.map((it) => (
          <button
            key={it.href}
            className={`nav-item ${isActive(it.href) ? "nav-item--active" : ""}`}
            onClick={() => go(it.href)}
          >
            <Icon className="nav-item__icon" name={it.icon} size={15} />
            {it.label}
            {it.count != null && <span className="nav-item__count t-num">{it.count}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        <div className="avatar">{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {email}
          </div>
          <div className="t-small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Resale workspace
          </div>
        </div>
        <button className="btn btn--ghost btn--icon btn--sm" title="Sign out" onClick={() => signOut()}>
          <Icon name="settings" size={14} />
        </button>
      </div>
    </aside>
  );
}
