import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import type { Side } from "../../../data/types";
import { SIDE_COLORS_UI } from "../../../config/side-colors";
import styles from "./FollowIndicator.module.css";

export function FollowIndicator(): JSX.Element {
  const engine = useEngine();

  const followData = () => {
    const id = engine.followTarget();
    if (id === null) return null;
    const entity = engine.entityManager.getEntity(id);
    if (!entity) return null;
    const snap = engine.entitySnapshots().get(id);
    const side = snap?.side ?? null;
    return { name: entity.name, side };
  };

  return (
    <Show when={followData()}>
      {(data) => (
        <div class={styles.chip} data-testid="follow-indicator">
          <Show when={data().side}>
            {(side) => (
              <span
                class={styles.dot}
                style={{ background: SIDE_COLORS_UI[side() as Side] }}
              />
            )}
          </Show>
          <span class={styles.name}>{data().name}</span>
          <button
            class={styles.close}
            onClick={() => engine.unfollowEntity()}
            aria-label="Stop following"
          >
            &times;
          </button>
        </div>
      )}
    </Show>
  );
}
