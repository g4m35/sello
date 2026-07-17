"use client";

import { useEffect } from "react";

const HERO_STATES = [
  ["photos", 1800],
  ["fields", 2000],
  ["ready", 1600],
  ["priced", 1600],
  ["published", 1800],
  ["sold", 1400],
  ["delisted", 1400],
  ["review", 1400],
  ["resolved", 3200],
] as const;

type PausableTimer = {
  cancel: () => void;
  pause: () => void;
  resume: () => void;
};

function createPausableTimer(callback: () => void, delay: number): PausableTimer {
  let cancelled = false;
  let remaining = delay;
  let startedAt: number | undefined;
  let timeoutId: number | undefined;

  const pause = () => {
    if (timeoutId === undefined || startedAt === undefined) return;

    remaining = Math.max(0, remaining - (window.performance.now() - startedAt));
    window.clearTimeout(timeoutId);
    timeoutId = undefined;
    startedAt = undefined;
  };

  const resume = () => {
    if (cancelled || timeoutId !== undefined || document.hidden) return;

    startedAt = window.performance.now();
    timeoutId = window.setTimeout(() => {
      cancelled = true;
      timeoutId = undefined;
      startedAt = undefined;
      callback();
    }, remaining);
  };

  const cancel = () => {
    cancelled = true;
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    timeoutId = undefined;
    startedAt = undefined;
  };

  const timer = { cancel, pause, resume };
  timer.resume();
  return timer;
}

export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector(".lp");
    if (!(root instanceof HTMLElement)) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compactViewport = window.matchMedia("(max-width: 767px)");
    const cleanups: (() => void)[] = [];
    const sequenceTimers = new Set<PausableTimer>();

    const scheduleSequenceStep = (callback: () => void, delay: number) => {
      const timer = createPausableTimer(() => {
        sequenceTimers.delete(timer);
        callback();
      }, delay);
      sequenceTimers.add(timer);
    };

    const handleVisibilityChange = () => {
      root.classList.toggle("is-motion-paused", document.hidden);
      sequenceTimers.forEach((timer) => {
        if (document.hidden) timer.pause();
        else timer.resume();
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    cleanups.push(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });

    if (!reduceMotion.matches && "IntersectionObserver" in window) {
      root.classList.add("lp-reveal-ready");
      const targets = root.querySelectorAll("[data-reveal]");
      const revealer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-in");
            revealer.unobserve(entry.target);
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
      );
      targets.forEach((target) => revealer.observe(target));
      cleanups.push(() => revealer.disconnect());
    }

    const nav = root.querySelector(".lp-nav");
    const sentinel = root.querySelector(".lp-nav-sentinel");
    if (
      nav instanceof HTMLElement &&
      sentinel instanceof HTMLElement &&
      "IntersectionObserver" in window
    ) {
      const watcher = new IntersectionObserver(([entry]) => {
        nav.classList.toggle("is-scrolled", !(entry?.isIntersecting ?? true));
      });
      watcher.observe(sentinel);
      cleanups.push(() => watcher.disconnect());
    }

    if (
      !reduceMotion.matches &&
      !compactViewport.matches &&
      "IntersectionObserver" in window
    ) {
      root.classList.add("lp-motion-ready");

      const hero = root.querySelector('[data-sequence="hero"]');
      if (hero instanceof HTMLElement) {
        let heroIndex = 0;
        let heroTimer: PausableTimer | undefined;
        let heroVisible = false;
        let heroHovered = false;

        const clearHeroTimer = () => {
          heroTimer?.cancel();
          heroTimer = undefined;
        };

        const advanceHero = () => {
          if (heroTimer || !heroVisible || heroHovered || document.hidden) return;

          const [state, duration] = HERO_STATES[heroIndex];
          hero.dataset.heroState = state;
          heroTimer = createPausableTimer(() => {
            heroTimer = undefined;
            heroIndex = (heroIndex + 1) % HERO_STATES.length;
            advanceHero();
          }, duration);
        };

        const resumeHeroTimer = () => {
          if (!heroVisible || heroHovered || document.hidden) return;
          if (heroTimer) heroTimer.resume();
          else advanceHero();
        };

        const heroObserver = new IntersectionObserver(
          ([entry]) => {
            heroVisible = entry?.isIntersecting ?? false;
            if (heroVisible) resumeHeroTimer();
            else heroTimer?.pause();
          },
          { threshold: 0.08 },
        );
        heroObserver.observe(hero);

        const pauseHero = () => {
          heroHovered = true;
          heroTimer?.pause();
        };
        const resumeHero = () => {
          heroHovered = false;
          resumeHeroTimer();
        };
        const syncHeroVisibility = () => {
          if (document.hidden) heroTimer?.pause();
          else resumeHeroTimer();
        };

        hero.addEventListener("mouseenter", pauseHero);
        hero.addEventListener("mouseleave", resumeHero);
        document.addEventListener("visibilitychange", syncHeroVisibility);
        cleanups.push(() => {
          clearHeroTimer();
          heroObserver.disconnect();
          hero.removeEventListener("mouseenter", pauseHero);
          hero.removeEventListener("mouseleave", resumeHero);
          document.removeEventListener("visibilitychange", syncHeroVisibility);
          delete hero.dataset.heroState;
        });
      }

      const lifecycle = root.querySelector('[data-sequence="lifecycle"]');
      const sync = root.querySelector('[data-sequence="sync"]');
      const bulk = root.querySelector('[data-sequence="bulk"]');
      const onePassTargets = [lifecycle, sync, bulk].filter(
        (target): target is HTMLElement => target instanceof HTMLElement,
      );

      const sequenceObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;

            const target = entry.target;
            target.classList.add("is-sequence-ready");
            sequenceObserver.unobserve(target);

            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                target.classList.add("is-playing");

                if (target.dataset.sequence !== "bulk") return;

                const rows = Array.from(
                  target.querySelectorAll<HTMLElement>("[data-manifest-row]"),
                );
                target.dataset.bulkState = "running";
                target.dataset.completeCount = "0";
                rows.forEach((row) => {
                  row.dataset.motionState = "idle";
                });

                rows.forEach((row, index) => {
                  scheduleSequenceStep(() => {
                    row.dataset.motionState = "generated";
                  }, 180 + index * 120);
                  scheduleSequenceStep(() => {
                    row.dataset.motionState = "priced";
                  }, 900 + index * 120);

                  if (row.dataset.recoveryRow === "true") return;
                  scheduleSequenceStep(() => {
                    row.dataset.motionState = "published";
                    const completeCount = Number(target.dataset.completeCount ?? "0") + 1;
                    target.dataset.completeCount = String(completeCount);
                  }, 1680 + index * 140);
                });

                const recoveryRow = target.querySelector<HTMLElement>(
                  '[data-recovery-row="true"]',
                );
                if (recoveryRow) {
                  scheduleSequenceStep(() => {
                    recoveryRow.dataset.motionState = "failed";
                  }, 2050);
                  scheduleSequenceStep(() => {
                    recoveryRow.dataset.motionState = "retry";
                  }, 2550);
                  scheduleSequenceStep(() => {
                    recoveryRow.dataset.motionState = "published";
                    target.dataset.completeCount = "5";
                  }, 3100);
                }

                scheduleSequenceStep(() => {
                  target.dataset.bulkState = "complete";
                }, 3600);
              });
            });
          }
        },
        { threshold: 0.24, rootMargin: "0px 0px -8% 0px" },
      );

      onePassTargets.forEach((target) => sequenceObserver.observe(target));
      cleanups.push(() => sequenceObserver.disconnect());
    }

    return () => {
      sequenceTimers.forEach((timer) => timer.cancel());
      cleanups.forEach((cleanup) => cleanup());
      root.classList.remove("lp-reveal-ready", "lp-motion-ready", "is-motion-paused");
    };
  }, []);

  return null;
}
