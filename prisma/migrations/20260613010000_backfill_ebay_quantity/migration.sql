UPDATE "ListingDraft"
SET "marketplaceDrafts" =
  CASE
    WHEN "marketplaceDrafts" IS NULL OR jsonb_typeof("marketplaceDrafts") <> 'object' THEN
      jsonb_build_object('ebay', jsonb_build_object('quantity', 1))
    WHEN "marketplaceDrafts" ? 'ebay'
      AND jsonb_typeof("marketplaceDrafts" -> 'ebay') = 'object' THEN
      jsonb_set(
        "marketplaceDrafts",
        '{ebay,quantity}',
        CASE
          WHEN jsonb_typeof("marketplaceDrafts" -> 'ebay' -> 'quantity') = 'number'
            AND (("marketplaceDrafts" -> 'ebay' ->> 'quantity')::numeric > 0)
          THEN "marketplaceDrafts" -> 'ebay' -> 'quantity'
          ELSE '1'::jsonb
        END,
        true
      )
    ELSE
      jsonb_set(
        "marketplaceDrafts",
        '{ebay}',
        jsonb_build_object('quantity', 1),
        true
      )
  END
WHERE
  ('ebay'::"Marketplace" = ANY("selectedMarketplaces"))
  OR (
    "marketplaceDrafts" IS NOT NULL
    AND jsonb_typeof("marketplaceDrafts") = 'object'
    AND "marketplaceDrafts" ? 'ebay'
  );
