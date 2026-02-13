import { createSignal, createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { HitKilledEvent } from "../../../playback/events/hit-killed-event";
import { formatElapsedTime } from "../../../playback/time";
import styles from "./BottomBar.module.css";

export function TimelineScrubber(): JSX.Element {
  const engine = useEngine();

  const [dragging, setDragging] = createSignal(false);
  const [hoverFrame, setHoverFrame] = createSignal<number | null>(null);
  let trackRef: HTMLDivElement | undefined;

  const killEvents = createMemo(() => {
    engine.endFrame(); // reactive dependency
    return engine.eventManager
      .getAll()
      .filter(
        (e) => e instanceof HitKilledEvent && e.type === "killed",
      );
  });

  const progress = createMemo(() =>
    engine.endFrame() > 0
      ? (engine.currentFrame() / engine.endFrame()) * 100
      : 0,
  );

  const frameFromEvent = (e: PointerEvent): number => {
    if (!trackRef) return 0;
    const rect = trackRef.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(pct * engine.endFrame());
  };

  const onPointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const frame = frameFromEvent(e);
    engine.seekTo(frame);
  };

  const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    const frame = frameFromEvent(e);
    setHoverFrame(frame);
    if (dragging()) {
      engine.seekTo(frame);
    }
  };

  const onPointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent> = () => {
    setDragging(false);
  };

  const onPointerLeave: JSX.EventHandler<HTMLDivElement, PointerEvent> = () => {
    setHoverFrame(null);
  };

  return (
    <div class={styles.scrubberWrap}>
      <div
        ref={trackRef}
        class={styles.scrubberTrack}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        <div
          class={styles.scrubberProgress}
          classList={{ [styles.scrubberProgressSmooth]: !dragging() }}
          style={{ width: `${progress()}%` }}
        />

        <For each={killEvents()}>
          {(ev) => (
            <div
              class={styles.eventMarker}
              style={{
                left: `${(ev.frameNum / engine.endFrame()) * 100}%`,
              }}
            />
          )}
        </For>

        <div
          class={styles.playhead}
          classList={{ [styles.playheadSmooth]: !dragging() }}
          style={{ left: `${progress()}%` }}
        />

        <Show when={hoverFrame() !== null}>
          <div
            class={styles.hoverTooltip}
            style={{
              left: `${(hoverFrame()! / engine.endFrame()) * 100}%`,
            }}
          >
            {formatElapsedTime(hoverFrame()!, engine.captureDelayMs())}
          </div>
        </Show>
      </div>
    </div>
  );
}
