import type { Accessor, JSX } from "solid-js";
import { createMemo } from "solid-js";
import { EyeOffIcon } from "../../../components/Icons";
import styles from "./BlacklistIndicator.module.css";

interface BlacklistIndicatorProps {
  blacklist: Accessor<Set<number>>;
  markerCounts: Accessor<Map<number, number>>;
}

export function BlacklistIndicator(props: BlacklistIndicatorProps): JSX.Element {
  const totalBlacklisted = createMemo(() => {
    let count = 0;
    const bl = props.blacklist();
    const mc = props.markerCounts();
    for (const playerId of bl) {
      count += mc.get(playerId) ?? 0;
    }
    return count;
  });

  return (
    <div class={styles.badge}>
      <EyeOffIcon size={14} />
      <span>{totalBlacklisted()} markers blacklisted</span>
    </div>
  );
}
