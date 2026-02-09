import { For } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../data/types";
import type { Unit } from "../../playback/entities/unit";
import { UnitListItem } from "./UnitListItem";

export interface SideGroupProps {
  side: Side;
  units: Unit[];
}

/**
 * Displays the unit list for a single side.
 *
 * Shows alive/total count in a header and renders a UnitListItem for each unit.
 */
export function SideGroup(props: SideGroupProps): JSX.Element {
  return (
    <div class="side-group" data-testid={`side-group-${props.side}`}>
      <div class="side-group-header" data-testid={`side-group-header-${props.side}`}>
        {props.side} ({props.units.length})
      </div>
      <div class="side-group-list">
        <For each={props.units}>
          {(unit) => <UnitListItem unit={unit} />}
        </For>
      </div>
    </div>
  );
}
