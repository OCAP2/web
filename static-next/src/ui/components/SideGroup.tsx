import { For } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../data/types";
import type { Unit } from "../../playback/entities/unit";
import { UnitListItem } from "./UnitListItem";
import styles from "./LeftPanel.module.css";

export interface SideGroupProps {
  side: Side;
  units: Unit[];
}

/**
 * Displays the unit list for a single side, grouped by squad/group name.
 *
 * Matches the old frontend: group name as a bold header, units indented below.
 * Groups are sorted alphabetically.
 */
export function SideGroup(props: SideGroupProps): JSX.Element {
  const grouped = () => {
    const groups = new Map<string, Unit[]>();
    for (const unit of props.units) {
      const key = unit.groupName || "Ungrouped";
      const list = groups.get(key);
      if (list) {
        list.push(unit);
      } else {
        groups.set(key, [unit]);
      }
    }
    // Sort groups alphabetically
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  return (
    <ul class={styles.unitList} data-testid={`side-group-${props.side}`}>
      <For each={grouped()}>
        {([groupName, units]) => (
          <li class={styles.groupItem} data-testid={`group-${groupName}`}>
            <div class={styles.sideTitle}>{groupName}</div>
            <For each={units}>
              {(unit) => <UnitListItem unit={unit} />}
            </For>
          </li>
        )}
      </For>
    </ul>
  );
}
