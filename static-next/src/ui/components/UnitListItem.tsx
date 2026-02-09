import type { JSX } from "solid-js";
import type { Unit } from "../../playback/entities/unit";
import { useEngine } from "../hooks/useEngine";

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
      class={`unit-list-item ${props.unit.sideClass}${props.unit.isPlayer ? " player" : ""}${isFollowed() ? " followed" : ""}`}
      data-testid={`unit-item-${props.unit.id}`}
      onClick={handleClick}
    >
      <span class={props.unit.isPlayer ? "unit-name player" : "unit-name"}>
        {props.unit.name}
      </span>
    </div>
  );
}
