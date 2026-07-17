import { describe, expect, it } from "vitest";

import { CONFIDENCE_THRESHOLDS } from "./sale-signal";
import {
  isActionableSignalType,
  parseMarketplaceEmail,
  type ParseMarketplaceEmailInput,
} from "./email-parser";

// Realistic (but FAKE) marketplace emails. No real order ids/urls/secrets. Each
// case asserts the three things the ingest route relies on: which marketplace,
// what signal, and which confidence band.

type Band = "high" | "medium" | "low";

function band(confidence: number): Band {
  if (confidence >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (confidence >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

function parse(partial: Partial<ParseMarketplaceEmailInput>) {
  return parseMarketplaceEmail({
    sourceEmail: partial.sourceEmail ?? "noreply@example.com",
    destinationEmail: partial.destinationEmail ?? "seller@inbox.sello.app",
    subject: partial.subject ?? "",
    textBody: partial.textBody ?? "",
    htmlBody: partial.htmlBody ?? null,
  });
}

describe("parseMarketplaceEmail — marketplace detection", () => {
  it("detects Grailed from sender + classifies a sale + high confidence (exact url)", () => {
    const result = parse({
      sourceEmail: "no-reply@grailed.com",
      subject: 'You made a sale: "Raf Simons Bomber Jacket"',
      textBody:
        "Congratulations, you sold an item! View the order here: " +
        "https://www.grailed.com/listings/483920 — please ship it within 3 days.",
    });
    expect(result.marketplaceGuess).toBe("grailed");
    expect(result.signalType).toBe("sale_detected");
    expect(result.matchHints.externalListingId).toBe("483920");
    expect(band(result.confidence)).toBe("high");
  });

  it("detects Depop from sender + sale + high confidence", () => {
    const result = parse({
      sourceEmail: "hello@depop.com",
      subject: 'Your item sold! "Vintage Carhartt Hoodie"',
      textBody:
        "Someone just bought your item. See it: https://www.depop.com/products/seller-carhartt-hoodie/",
    });
    expect(result.marketplaceGuess).toBe("depop");
    expect(result.signalType).toBe("sale_detected");
    expect(result.matchHints.externalUrl).toContain("depop.com/products");
    expect(band(result.confidence)).toBe("high");
  });

  it("detects Poshmark from sender + sale (medium when only a strong title, no url)", () => {
    const result = parse({
      sourceEmail: "support@poshmark.com",
      subject: 'Congratulations on your sale — "Lululemon Align Leggings Size 6"',
      textBody:
        "You sold an item on Poshmark! A shipping label is on the way to your email.",
    });
    expect(result.marketplaceGuess).toBe("poshmark");
    expect(result.signalType).toBe("sale_detected");
    expect(result.extracted.title).toBe("Lululemon Align Leggings Size 6");
    expect(band(result.confidence)).toBe("medium");
  });

  it("detects eBay from sender + sale + high confidence (itm url + price)", () => {
    const result = parse({
      sourceEmail: "ebay@reply.ebay.com",
      subject: 'Your item sold: "Sony WH-1000XM4 Headphones"',
      textBody:
        "Great news — your item sold for $189.99. Order number: 12-09876-54321. " +
        "https://www.ebay.com/itm/285012345678",
    });
    expect(result.marketplaceGuess).toBe("ebay");
    expect(result.signalType).toBe("sale_detected");
    expect(result.matchHints.externalListingId).toBe("285012345678");
    expect(result.extracted.priceCents).toBe(18999);
    expect(result.extracted.orderId).toBe("12-09876-54321");
    expect(band(result.confidence)).toBe("high");
  });

  it("detects Etsy from sender + sale + high confidence (listing url)", () => {
    const result = parse({
      sourceEmail: "transaction@mail.etsy.com",
      subject: 'You made a sale on Etsy! "Handmade Ceramic Mug"',
      textBody:
        "You have a new order. Listing: https://www.etsy.com/listing/1234567890/handmade-ceramic-mug",
    });
    expect(result.marketplaceGuess).toBe("etsy");
    expect(result.signalType).toBe("sale_detected");
    expect(result.matchHints.externalListingId).toBe("1234567890");
    expect(band(result.confidence)).toBe("high");
  });

  it("detects Vinted from sender + sale + high confidence (items url)", () => {
    const result = parse({
      sourceEmail: "no-reply@vinted.com",
      subject: 'Your item was purchased: "Nike Tech Fleece Joggers"',
      textBody:
        "Good news! Your item sold. View it here https://www.vinted.com/items/3920184 and ship soon.",
    });
    expect(result.marketplaceGuess).toBe("vinted");
    expect(result.signalType).toBe("sale_detected");
    expect(result.matchHints.externalListingId).toBe("3920184");
    expect(band(result.confidence)).toBe("high");
  });

  it("detects Mercari from sender + sale + high confidence (item url)", () => {
    const result = parse({
      sourceEmail: "no-reply@mail.mercari.com",
      subject: 'Sold! "Levi\'s 501 Jeans" has a buyer',
      textBody:
        "Your item sold on Mercari. View the order for https://www.mercari.com/us/item/m98765432101/ and ship within 3 days.",
    });
    expect(result.marketplaceGuess).toBe("mercari");
    expect(result.signalType).toBe("sale_detected");
    expect(band(result.confidence)).toBe("high");
  });

  it("detects StockX payment signal from sender", () => {
    const result = parse({
      sourceEmail: "noreply@stockx.com",
      subject: "Payment received for your sale",
      textBody:
        "Your payout has been processed. Track it: https://stockx.com/nike-dunk-low-panda",
    });
    expect(result.marketplaceGuess).toBe("stockx");
    expect(result.signalType).toBe("payment_received");
    expect(isActionableSignalType(result.signalType)).toBe(true);
  });

  it("detects TikTok Shop sale from sender", () => {
    const result = parse({
      sourceEmail: "noreply@shop.tiktok.com",
      subject: 'You have a new order — "Phone Case Bundle"',
      textBody:
        "You got an order on TikTok Shop. Order id: TT78901234. Ship it from your seller center.",
    });
    expect(result.marketplaceGuess).toBe("tiktok_shop");
    expect(result.signalType).toBe("sale_detected");
    expect(result.extracted.orderId).toBe("TT78901234");
  });
});

describe("parseMarketplaceEmail — signal classification", () => {
  it("classifies shipping_needed", () => {
    const result = parse({
      sourceEmail: "no-reply@grailed.com",
      subject: "Time to ship your order",
      textBody: "Please print your shipping label and ship your item within 3 days.",
    });
    expect(result.signalType).toBe("shipping_needed");
    expect(isActionableSignalType(result.signalType)).toBe(true);
  });

  it("classifies offer_received (NOT actionable for the engine)", () => {
    const result = parse({
      sourceEmail: "hello@depop.com",
      subject: "You received an offer",
      textBody: "A buyer made you an offer of $40 on your listing.",
    });
    expect(result.signalType).toBe("offer_received");
    expect(isActionableSignalType(result.signalType)).toBe(false);
  });

  it("classifies listing_published", () => {
    const result = parse({
      sourceEmail: "transaction@mail.etsy.com",
      subject: "Your listing is live",
      textBody: "Your item is listed and now for sale on Etsy.",
    });
    expect(result.signalType).toBe("listing_published");
    expect(isActionableSignalType(result.signalType)).toBe(false);
  });

  it("classifies listing_removed", () => {
    const result = parse({
      sourceEmail: "no-reply@vinted.com",
      subject: "Your listing has ended",
      textBody: "Your listing was removed because it expired.",
    });
    expect(result.signalType).toBe("listing_removed");
  });

  it("classifies payment_received", () => {
    const result = parse({
      sourceEmail: "support@poshmark.com",
      subject: "You've been paid",
      textBody: "Your payment received for the recent sale is on the way.",
    });
    expect(result.signalType).toBe("payment_received");
  });

  it("returns unknown + low confidence for non-sale marketplace email", () => {
    const result = parse({
      sourceEmail: "no-reply@grailed.com",
      subject: "Weekly digest: trending items this week",
      textBody: "Here are some items we think you'll love.",
    });
    expect(result.signalType).toBe("unknown");
    expect(band(result.confidence)).toBe("low");
  });
});

describe("parseMarketplaceEmail — confidence bands", () => {
  it("low when a sale phrase appears from an UNKNOWN sender with no match", () => {
    const result = parse({
      sourceEmail: "friend@gmail.com",
      subject: "fwd: you made a sale",
      textBody: "thought you'd want to see this",
    });
    expect(result.signalType).toBe("sale_detected");
    expect(band(result.confidence)).toBe("low");
  });

  it("keyword fallback still guesses the marketplace from a forwarded body", () => {
    const result = parse({
      sourceEmail: "friend@gmail.com",
      subject: "fwd: your grailed item sold",
      textBody: "Your item sold on grailed, congrats!",
    });
    expect(result.marketplaceGuess).toBe("grailed");
    // Forwarded => sender not the marketplace => never high.
    expect(band(result.confidence)).not.toBe("high");
  });

  it("never throws and returns unknown on empty input", () => {
    const result = parse({});
    expect(result.signalType).toBe("unknown");
    expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLDS.medium);
    expect(result.matchHints).toEqual({});
  });
});
