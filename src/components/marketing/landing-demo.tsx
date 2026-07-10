"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const STEPS = [
  {
    id: "upload",
    label: "Upload",
    title: "Drop in photos",
    blurb: "Raw item shots — no studio setup required.",
  },
  {
    id: "draft",
    label: "Draft",
    title: "Sello writes the listing",
    blurb: "Title, specifics, measurements, and flaws.",
  },
  {
    id: "comps",
    label: "Price",
    title: "Sold-comp guidance",
    blurb: "Evidence-backed price with a confidence score.",
  },
  {
    id: "publish",
    label: "Publish",
    title: "Ship to channels",
    blurb: "Publish across marketplaces. Sync inventory and delist when sold.",
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const AUTO_MS = 4800;

function getReduceMotionSnapshot() {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function subscribeReduceMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function LandingDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useSyncExternalStore(
    subscribeReduceMotion,
    getReduceMotionSnapshot,
    () => false,
  );

  useEffect(() => {
    if (paused || reduceMotion) return;
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, reduceMotion]);

  const current = STEPS[step]!;
  const activeId: StepId = current.id;

  return (
    <div
      className="landing-demo"
      id="demo"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className="landing-demo__tabs" role="tablist" aria-label="Product demo steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === step}
            className={
              i === step
                ? "landing-demo__tab landing-demo__tab--active"
                : "landing-demo__tab"
            }
            onClick={() => setStep(i)}
          >
            <span className="landing-demo__tab-n">{String(i + 1).padStart(2, "0")}</span>
            {s.label}
            {i === step && !paused && !reduceMotion ? (
              <span className="landing-demo__progress" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>

      <div
        className="landing-demo__stage"
        role="tabpanel"
        aria-label={current.title}
      >
        <div className="landing-demo__chrome">
          <span />
          <span />
          <span />
          <p className="landing-demo__chrome-title">Sello · listing draft</p>
        </div>

        <div className={`landing-demo__scene landing-demo__scene--${activeId}`}>
          {activeId === "upload" ? <SceneUpload /> : null}
          {activeId === "draft" ? <SceneDraft /> : null}
          {activeId === "comps" ? <SceneComps /> : null}
          {activeId === "publish" ? <ScenePublish /> : null}
        </div>

        <div className="landing-demo__caption">
          <p className="landing-demo__caption-title">{current.title}</p>
          <p className="landing-demo__caption-blurb">{current.blurb}</p>
        </div>
      </div>
    </div>
  );
}

function SceneUpload() {
  return (
    <div className="demo-upload">
      <div className="demo-upload__drop">
        <div className="demo-upload__photo" aria-hidden="true">
          <svg viewBox="0 0 120 140" fill="none">
            <rect x="28" y="18" width="64" height="88" rx="8" fill="currentColor" opacity="0.12" />
            <path
              d="M40 95 L52 55 L64 78 L72 62 L88 95 Z"
              fill="currentColor"
              opacity="0.35"
            />
            <circle cx="70" cy="42" r="8" fill="currentColor" opacity="0.25" />
          </svg>
        </div>
        <p>Drop photos here</p>
        <span>JPG · PNG · HEIC</span>
      </div>
      <ul className="demo-upload__thumbs">
        <li className="demo-upload__thumb demo-upload__thumb--on" />
        <li className="demo-upload__thumb" />
        <li className="demo-upload__thumb" />
      </ul>
    </div>
  );
}

function SceneDraft() {
  return (
    <div className="demo-draft">
      <div className="demo-draft__photo" aria-hidden="true" />
      <div className="demo-draft__fields">
        <label>
          Title
          <span className="demo-draft__fill demo-draft__fill--1">
            Acne Studios wool coat · charcoal · M
          </span>
        </label>
        <label>
          Category
          <span className="demo-draft__fill demo-draft__fill--2">
            Men → Coats &amp; Jackets
          </span>
        </label>
        <div className="demo-draft__row">
          <label>
            Size
            <span className="demo-draft__fill demo-draft__fill--3">M</span>
          </label>
          <label>
            Condition
            <span className="demo-draft__fill demo-draft__fill--4">Excellent</span>
          </label>
        </div>
        <label>
          Measurements
          <span className="demo-draft__fill demo-draft__fill--5">
            Chest 42″ · Length 38″ · Sleeve 25″
          </span>
        </label>
      </div>
    </div>
  );
}

function SceneComps() {
  return (
    <div className="demo-comps">
      <div className="demo-comps__price">
        <span className="demo-comps__label">Suggested price</span>
        <p className="demo-comps__amount">$285</p>
        <span className="demo-comps__conf">
          Confidence <strong>82%</strong>
        </span>
      </div>
      <ul className="demo-comps__list">
        <li>
          <span>Sold · eBay</span>
          <strong>$295</strong>
        </li>
        <li>
          <span>Sold · Grailed</span>
          <strong>$270</strong>
        </li>
        <li>
          <span>Sold · eBay</span>
          <strong>$310</strong>
        </li>
      </ul>
    </div>
  );
}

function ScenePublish() {
  return (
    <div className="demo-publish">
      <article className="demo-publish__card demo-publish__card--primary">
        <span className="demo-publish__badge">Automated</span>
        <h4>eBay</h4>
        <p>Publish directly through official APIs.</p>
        <span className="demo-publish__cta">Publish listing</span>
      </article>
      <article className="demo-publish__card">
        <span className="demo-publish__badge demo-publish__badge--soft">Assisted</span>
        <h4>Grailed · Poshmark · Depop</h4>
        <p>Channel-ready listing packages you post yourself.</p>
        <span className="demo-publish__cta demo-publish__cta--ghost">Export package</span>
      </article>
    </div>
  );
}
