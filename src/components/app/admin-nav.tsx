"use client";

import Link from "next/link";

const ADMIN_TABS = [
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/provider-usage", label: "Provider usage" },
  { href: "/admin/marketplace-operations", label: "Marketplace ops" },
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number]["href"];

// Compact nav shared by the admin surfaces. Each page still has its own server
// layout guard and independent API guard; this is navigation only.
export function AdminNav({ active }: { active: AdminTab }) {
  return (
    <div className="tabs" style={{ marginBottom: 12 }}>
      {ADMIN_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`tab ${active === tab.href ? "tab--active" : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
