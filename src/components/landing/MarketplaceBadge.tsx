type MarketplaceBadgeProps = {
  name: string;
  status?: string;
  tone?: "ready" | "review" | "copy" | "target" | "neutral";
};

export function MarketplaceBadge({
  name,
  status,
  tone = "neutral",
}: MarketplaceBadgeProps) {
  return (
    <div className={`marketplace-badge marketplace-badge--${tone}`}>
      <span className="marketplace-badge__mark" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
      <span className="marketplace-badge__body">
        <span className="marketplace-badge__name">{name}</span>
        {status && <span className="marketplace-badge__status">{status}</span>}
      </span>
    </div>
  );
}
