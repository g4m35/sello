"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  ImageIcon,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";

const item = {
  title: "Supreme Box Logo Hoodie Black FW21",
  price: "$185",
  sku: "SUP-FW21-BLK-L",
  category: "Men's Hoodies & Sweatshirts",
};

const fields = [
  ["Title", item.title],
  ["Description", "Black Supreme box logo hoodie with ribbed cuffs and minimal signs of wear."],
  ["Category", "Hoodies"],
  ["Condition", "Excellent used condition"],
  ["Item specifics", "Brand: Supreme · Size: Large · Color: Black"],
  ["Measurements", "Chest 23 in · Length 28 in"],
];

const priceMetrics = [
  ["Sold median", "$184"],
  ["Comp range", "$172-$205"],
  ["Confidence", "High"],
  ["Est. payout", "$161"],
];

const chosenMarketplaces = [
  ["eBay", "Draft ready"],
  ["StockX", "Size review"],
  ["Grailed", "Copy ready"],
  ["Depop", "Copy ready"],
];

export function DemoFlow() {
  const [isPlaying, setIsPlaying] = useState(true);

  return (
    <section id="demo" className="landing-section landing-section--demo motion-demo">
      <div className="landing-section__head motion-demo__head">
        <h2>See what Sello does in one pass.</h2>
        <p>
          Photos go in. Sello creates a priced, marketplace-ready listing and
          ends on an eBay draft for seller review.
        </p>
      </div>

      <div
        className={isPlaying ? "motion-panel" : "motion-panel motion-panel--paused"}
        aria-label="Actual animation of one resale listing moving through Sello"
      >
        <div className="motion-panel__top">
          <div className="tour-window-controls" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="tour-address">
            <span>sello.wtf</span>
            <strong>/listings/new-to-ebay</strong>
          </div>
          <button
            type="button"
            className="tour-control"
            onClick={() => setIsPlaying((value) => !value)}
            aria-pressed={isPlaying}
            aria-label={isPlaying ? "Pause animation" : "Play animation"}
          >
            <span className="tour-control__icon" aria-hidden="true">
              <span className={isPlaying ? "tour-control__glyph tour-control__glyph--active" : "tour-control__glyph"}>
                <Pause size={14} />
              </span>
              <span className={isPlaying ? "tour-control__glyph" : "tour-control__glyph tour-control__glyph--active"}>
                <Play size={14} />
              </span>
            </span>
            <span className="tour-control__label">{isPlaying ? "Playing" : "Paused"}</span>
          </button>
        </div>

        <div className="motion-stage">
          <div className="motion-rail" aria-hidden="true">
            <span className="motion-rail__line" />
            <span className="motion-rail__dot motion-rail__dot--one" />
            <span className="motion-rail__dot motion-rail__dot--two" />
            <span className="motion-rail__dot motion-rail__dot--three" />
          </div>

          <section className="motion-block motion-upload">
            <div className="motion-block__label">
              <ImageIcon size={14} />
              <span>Photos</span>
            </div>
            <div className="motion-photo-stack" aria-label="Uploaded item photos">
              {["Front", "Logo", "Tag"].map((photo, index) => (
                <div key={photo} className={`motion-photo motion-photo--${index + 1}`}>
                  <span>{photo}</span>
                  <strong>{index + 1}</strong>
                </div>
              ))}
              <span className="motion-scan" aria-hidden="true" />
            </div>
          </section>

          <section className="motion-block motion-listing">
            <div className="motion-block__label">
              <Sparkles size={14} />
              <span>AI listing</span>
            </div>
            <div className="motion-field-list">
              {fields.map(([label, value], index) => (
                <div key={label} className={`motion-field motion-field--${index + 1}`}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <em aria-hidden="true" />
                </div>
              ))}
            </div>
          </section>

          <section className="motion-block motion-pricer">
            <div className="motion-block__label">
              <CircleDollarSign size={14} />
              <span>Pricing</span>
            </div>
            <strong>{item.price}</strong>
            <div className="motion-price-metrics">
              {priceMetrics.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="motion-comp-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </section>

          <section className="motion-block motion-routing">
            <div className="motion-block__label">
              <RefreshCw size={14} />
              <span>Chosen marketplaces</span>
            </div>
            <div className="motion-marketplace-grid">
              {chosenMarketplaces.map(([marketplace, status]) => (
                <div
                  key={marketplace}
                  className={marketplace === "eBay" ? "motion-marketplace motion-marketplace--ready" : "motion-marketplace"}
                >
                  <strong>{marketplace}</strong>
                  <span>{status}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="motion-ebay" aria-label="Mock eBay listing ending">
            <div className="motion-ebay__bar">
              <strong>eBay</strong>
              <span>Draft ready for seller review</span>
            </div>
            <div className="motion-ebay__body">
              <div className="motion-ebay__image">
                <span>1</span>
              </div>
              <div>
                <p>Listing preview</p>
                <h3>{item.title}</h3>
                <strong>{item.price}</strong>
                <ul>
                  <li>{item.category}</li>
                  <li>SKU: {item.sku}</li>
                  <li>Seller approval gate required before publishing</li>
                </ul>
              </div>
            </div>
            <div className="motion-ebay__ready">
              <CheckCircle2 size={15} />
              <span>Ready, not live</span>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
