import type { JSX } from "solid-js";
import type { Unit } from "../../playback/entities/unit";
import { useEngine } from "../hooks/useEngine";
import styles from "./LeftPanel.module.css";

export interface UnitListItemProps {
  unit: Unit;
}

/**
 * Single row in the unit list.
 *
 * - Name is bold when the unit is a player, normal for AI.
 * - Text colour uses the unit's side CSS class (blufor/opfor/ind/civ).
 * - Click follows the unit on the map.
 * - The currently followed unit gets a visual highlight.
 */
export function UnitListItem(props: UnitListItemProps): JSX.Element {
  const engine = useEngine();

  const handleClick = () => {
    engine.followEntity(props.unit.id);
  };

  const isFollowed = () => engine.followTarget() === props.unit.id;

  return (
    <div
      class={`${styles.unitItem}${props.unit.isPlayer ? " player" : ""}${isFollowed() ? " followed" : ""}`}
      data-testid={`unit-item-${props.unit.id}`}
      onClick={handleClick}
    >
      {props.unit.name}{!props.unit.isPlayer && " [AI]"} ({props.unit.killCount})
    </div>
  );
}
