"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  LandingTicket,
  type TicketItem,
  type TicketStage,
} from "@/components/marketing/landing-ticket";

export type FlowStep = {
  id: TicketStage;
  title: string;
  blurb: string;
};

const AUTO_MS = 5200;

function mediaStore(query: string) {
  return {
    subscribe(cb: () => void) {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    getSnapshot() {
      return typeof window !== "undefined" && window.matchMedia(query).matches;
    },
  };
}

const reduceMotion = mediaStore("(prefers-reduced-motion: reduce)");
const finePointer = mediaStore("(pointer: fine)");

export function LandingFlow({
  steps,
  item,
}: {
  steps: FlowStep[];
  item: TicketItem;
}) {
  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const prefersStill = useSyncExternalStore(
    reduceMotion.subscribe,
    reduceMotion.getSnapshot,
    () => false,
  );
  const hasFinePointer = useSyncExternalStore(
    finePointer.subscribe,
    finePointer.getSnapshot,
    () => false,
  );

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry?.isIntersecting ?? false);
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const playing =
    inView && hasFinePointer && !prefersStill && !userPaused && !hoverPaused;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % steps.length);
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [playing, steps.length]);

  const select = (index: number) => {
    setActive(index);
    setUserPaused(true);
  };

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = steps.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = index === last ? 0 : index + 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = index === 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }
    if (next === null) return;
    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  const step = steps[active]!;

  return (
    <div
      ref={rootRef}
      className="lp-flow"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
    >
      <div className="lp-flow__rail">
        <div
          className="lp-flow__tabs"
          role="tablist"
          aria-label="Listing flow steps"
          aria-orientation="vertical"
        >
          {steps.map((entry, index) => {
            const isActive = index === active;
            return (
              <button
                key={entry.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`lp-flow-tab-${entry.id}`}
                aria-selected={isActive}
                aria-controls="lp-flow-stage"
                tabIndex={isActive ? 0 : -1}
                className={`lp-flow__tab${isActive ? " is-active" : ""}`}
                onClick={() => select(index)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                <span className="lp-flow__tab-n">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="lp-flow__tab-copy">
                  <span className="lp-flow__tab-title">{entry.title}</span>
                  <span className="lp-flow__tab-blurb">{entry.blurb}</span>
                </span>
                {isActive && playing ? (
                  <span className="lp-flow__tab-progress" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="lp-flow__pause"
          aria-pressed={userPaused}
          onClick={() => setUserPaused((paused) => !paused)}
        >
          {userPaused ? "▶ Play steps" : "⏸ Pause steps"}
        </button>
      </div>

      <div
        id="lp-flow-stage"
        className="lp-flow__stage"
        role="tabpanel"
        aria-labelledby={`lp-flow-tab-${step.id}`}
      >
        <LandingTicket item={item} stage={step.id} />
      </div>
    </div>
  );
}
