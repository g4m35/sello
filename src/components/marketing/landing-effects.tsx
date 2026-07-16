"use client";

import { useEffect } from "react";

// Progressive-enhancement effects for the landing page:
// - scroll reveals: gate styles behind `lp-reveal-ready` so content stays
//   visible when JS never runs, then flip `is-in` as sections enter.
// - sticky nav: toggle a scrolled state off a top sentinel.
// Hero content is deliberately not gated (renders at rest, instantly).
export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector(".lp");
    if (!(root instanceof HTMLElement)) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cleanups: (() => void)[] = [];

    if (!reduce.matches) {
      root.classList.add("lp-reveal-ready");
      const targets = root.querySelectorAll("[data-reveal]");
      const revealer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-in");
              revealer.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
      );
      targets.forEach((target) => revealer.observe(target));
      cleanups.push(() => revealer.disconnect());
    }

    const nav = root.querySelector(".lp-nav");
    const sentinel = root.querySelector(".lp-nav-sentinel");
    if (nav instanceof HTMLElement && sentinel instanceof HTMLElement) {
      const watcher = new IntersectionObserver(([entry]) => {
        nav.classList.toggle("is-scrolled", !(entry?.isIntersecting ?? true));
      });
      watcher.observe(sentinel);
      cleanups.push(() => watcher.disconnect());
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      root.classList.remove("lp-reveal-ready");
    };
  }, []);

  return null;
}
