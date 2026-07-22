import type { Card } from "../game/types";
import { bullsLabel, getPointsRule } from "../game/card";

type Props = {
  card: Card | null;
  hidden?: boolean;
  size?: "md" | "sm";
  selected?: boolean;
  selectable?: boolean;
  hot?: boolean;
  onClick?: () => void;
};

export function CardView({
  card,
  hidden,
  size = "md",
  selected,
  selectable,
  hot,
  onClick,
}: Props) {
  if (hidden || (card && card.number === 0)) {
    return (
      <div className={`card card--hidden ${size === "sm" ? "card--sm" : ""}`} aria-label="Hidden card">
        <div className="card-number">?</div>
        <div className="card-bulls">🐂</div>
      </div>
    );
  }

  if (!card) {
    return (
      <div
        className={`card ${size === "sm" ? "card--sm" : ""}`}
        style={{ opacity: 0.25, borderStyle: "dashed" }}
      />
    );
  }

  const isHot = hot || card.points >= 5;
  const pointsInfo = getPointsRule(card.number);
  const title = isHot
    ? `Red border: ${pointsInfo.points} bull heads — ${pointsInfo.rule}. ${pointsInfo.detail}`
    : `Card ${card.number}: ${pointsInfo.points} bull head${pointsInfo.points === 1 ? "" : "s"} (${pointsInfo.rule})`;

  const className = [
    "card",
    size === "sm" ? "card--sm" : "",
    selectable ? "card--selectable" : "",
    selected ? "card--selected" : "",
    isHot ? "card--hot" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      onClick={selectable ? onClick : undefined}
      aria-disabled={!selectable}
      tabIndex={selectable ? 0 : -1}
      title={title}
      aria-label={
        isHot
          ? `Card ${card.number}, red border: ${pointsInfo.points} bull heads because ${pointsInfo.rule}`
          : `Card ${card.number}, ${card.points} bull heads (${pointsInfo.rule})`
      }
    >
      <div className="card-number">{card.number}</div>
      <div className="card-bulls">{bullsLabel(card.points)}</div>
      <div className="card-pt" style={{ fontSize: "0.65rem", fontWeight: 700, opacity: 0.7 }}>
        {card.points}pt
      </div>
    </button>
  );
}
