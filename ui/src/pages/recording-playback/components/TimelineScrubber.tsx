import { createSignal, createMemo, For, Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { HitKilledEvent } from "../../../playback/events/hitKilledEvent";
import { formatElapsedTime } from "../../../playback/time";
import type { FocusRange } from "./FocusToolbar";
import styles from "./BottomBar.module.css";

const BUCKET_COUNT = 120;
const HEATMAP_HEIGHT = 28;

interface HeatmapBucket {
  frameStart: number;
  frameEnd: number;
  kills: number;
  hits: number;
  other: number;
}

export interface TimelineScrubberProps {
  focusRange: Accessor<FocusRange | null>;
  editingFocus: Accessor<boolean>;
  focusDraft: Accessor<FocusRange | null>;
  onDraftChange: (draft: FocusRange) => void;
}

export function TimelineScrubber(props: TimelineScrubberProps): JSX.Element {
  const engine = useEngine();

  const [dragging, setDragging] = createSignal(false);
  const [hoverFrame, setHoverFrame] = createSignal<number | null>(null);
  const [draggingHandle, setDraggingHandle] = createSignal<"in" | "out" | null>(null);
  let trackRef: HTMLDivElement | undefined;
  let wasPlaying = false;

  const activeFocus = () => props.editingFocus() ? props.focusDraft() : props.focusRange();
  const focusInPct = () => {
    const f = activeFocus();
    return f ? (f.inFrame / engine.endFrame()) * 100 : 0;
  };
  const focusOutPct = () => {
    const f = activeFocus();
    return f ? (f.outFrame / engine.endFrame()) * 100 : 100;
  };

  const killEvents = createMemo(() => {
    engine.endFrame(); // reactive dependency
    return engine.eventManager
      .getAll()
      .filter(
        (e) => e instanceof HitKilledEvent && e.type === "killed",
      );
  });

  const heatmapData = createMemo(() => {
    const total = engine.endFrame();
    if (total === 0) return { buckets: [] as HeatmapBucket[], maxVal: 1 };

    const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
      frameStart: (i / BUCKET_COUNT) * total,
      frameEnd: ((i + 1) / BUCKET_COUNT) * total,
      kills: 0,
      hits: 0,
      other: 0,
    }));

    for (const ev of engine.eventManager.getAll()) {
      const idx = Math.min(Math.floor((ev.frameNum / total) * BUCKET_COUNT), BUCKET_COUNT - 1);
      if (ev instanceof HitKilledEvent) {
        if (ev.type === "killed") buckets[idx].kills++;
        else buckets[idx].hits++;
      } else {
        buckets[idx].other++;
      }
    }

    const maxVal = Math.max(1, ...buckets.map(b => b.kills + b.hits + b.other));
    return { buckets, maxVal };
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
    if (!dragging()) {
      wasPlaying = engine.isPlaying();
      if (wasPlaying) engine.pause();
    }
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const frame = frameFromEvent(e);
    engine.seekTo(frame);
  };

  const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    const frame = frameFromEvent(e);
    setHoverFrame(frame);

    if (draggingHandle() && props.focusDraft()) {
      const d = props.focusDraft()!;
      if (draggingHandle() === "in") {
        props.onDraftChange({ ...d, inFrame: Math.max(0, Math.min(frame, d.outFrame - 5)) });
      } else {
        props.onDraftChange({ ...d, outFrame: Math.min(engine.endFrame(), Math.max(frame, d.inFrame + 5)) });
      }
      return;
    }

    if (dragging()) {
      engine.seekTo(frame);
    }
  };

  const onPointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent> = () => {
    if (draggingHandle()) {
      setDraggingHandle(null);
      return;
    }
    setDragging(false);
    if (wasPlaying) {
      wasPlaying = false;
      engine.play();
    }
  };

  const onPointerLeave: JSX.EventHandler<HTMLDivElement, PointerEvent> = () => {
    setHoverFrame(null);
  };

  return (
    <div class={styles.scrubberWrap}>
      <div
        ref={trackRef}
        data-testid="scrubber-track"
        class={styles.scrubberTrack}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        {/* Activity heatmap bars */}
        <div class={styles.heatmapContainer}>
          <For each={heatmapData().buckets}>
            {(bucket) => {
              const total = bucket.kills + bucket.hits + bucket.other;
              if (total === 0) return <div class={styles.heatmapBucketEmpty} />;
              const h = Math.max(2, (total / heatmapData().maxVal) * HEATMAP_HEIGHT);
              const killH = (bucket.kills / total) * h;
              const hitH = (bucket.hits / total) * h;
              const otherH = h - killH - hitH;
              const isPast = () => bucket.frameEnd <= engine.currentFrame();
              const isOutsideFocus = () => {
                const focus = activeFocus();
                if (!focus) return false;
                const bucketMid = (bucket.frameStart + bucket.frameEnd) / 2;
                return bucketMid < focus.inFrame || bucketMid > focus.outFrame;
              };
              return (
                <div
                  class={styles.heatmapBucket}
                  classList={{ [styles.heatmapBucketPast]: isPast(), [styles.heatmapBucketDimmed]: isOutsideFocus() }}
                  style={{ height: `${h}px` }}
                  data-testid="heatmap-bucket"
                >
                  <Show when={bucket.other > 0}>
                    <div class={styles.heatmapOther} style={{ height: `${otherH}px` }} />
                  </Show>
                  <Show when={bucket.hits > 0}>
                    <div class={styles.heatmapHit} style={{ height: `${hitH}px` }} />
                  </Show>
                  <Show when={bucket.kills > 0}>
                    <div class={styles.heatmapKill} style={{ height: `${killH}px` }} />
                  </Show>
                </div>
              );
            }}
          </For>
        </div>

        {/* Thin scrub track at bottom */}
        <div class={styles.trackBar}>
          <div
            data-testid="scrubber-progress"
            class={styles.scrubberProgress}
            classList={{ [styles.scrubberProgressSmooth]: !dragging() }}
            style={{ width: `${progress()}%` }}
          />
        </div>

        {/* Kill tick marks */}
        <For each={killEvents()}>
          {(ev) => (
            <div
              data-testid="event-marker"
              class={styles.eventMarker}
              style={{ left: `${(ev.frameNum / engine.endFrame()) * 100}%` }}
            />
          )}
        </For>

        {/* Playhead: full-height vertical line + bottom knob */}
        <div
          class={styles.playheadLine}
          classList={{ [styles.playheadSmooth]: !dragging() }}
          style={{ left: `${progress()}%` }}
        >
          <div class={styles.playheadKnob} />
        </div>

        {/* Hover line + tooltip */}
        <Show when={hoverFrame() !== null}>
          <div
            class={styles.hoverLine}
            style={{ left: `${(hoverFrame()! / engine.endFrame()) * 100}%` }}
          />
          <div
            class={styles.hoverTooltip}
            style={{ left: `${(hoverFrame()! / engine.endFrame()) * 100}%` }}
          >
            {formatElapsedTime(hoverFrame()!, engine.captureDelayMs())}
          </div>
        </Show>

        {/* Focus dim overlays */}
        <Show when={activeFocus()}>
          {(_focus) => (<>
            <Show when={focusInPct() > 0}>
              <div
                class={styles.focusDimOverlay}
                style={{ left: "0", width: `${focusInPct()}%` }}
              />
            </Show>
            <Show when={focusOutPct() < 100}>
              <div
                class={styles.focusDimOverlay}
                style={{ right: "0", width: `${100 - focusOutPct()}%` }}
              />
            </Show>

            {/* Gold accent line or dashed border in edit mode */}
            <Show when={props.editingFocus()} fallback={
              <div
                class={styles.focusAccentLine}
                style={{ left: `${focusInPct()}%`, width: `${focusOutPct() - focusInPct()}%` }}
              />
            }>
              <div
                class={styles.focusBorderEditing}
                style={{ left: `${focusInPct()}%`, width: `${focusOutPct() - focusInPct()}%` }}
              />
            </Show>

            {/* Focus tick marks (view mode) */}
            <Show when={!props.editingFocus()}>
              <div class={styles.focusTick} style={{ left: `${focusInPct()}%` }} />
              <div class={styles.focusTick} style={{ left: `${focusOutPct()}%` }} />
            </Show>
          </>)}
        </Show>

        {/* Focus handles (edit mode) */}
        <Show when={props.editingFocus() && props.focusDraft()}>
          <div
            class={styles.focusHandle}
            style={{ left: `${focusInPct()}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingHandle("in");
              (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture(e.pointerId);
            }}
          />
          <div
            class={styles.focusHandle}
            style={{ left: `${focusOutPct()}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingHandle("out");
              (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture(e.pointerId);
            }}
          />
          <div class={styles.focusHandleLabel} style={{ left: `${focusInPct()}%` }}>
            {formatElapsedTime(props.focusDraft()!.inFrame, engine.captureDelayMs())}
          </div>
          <div class={styles.focusHandleLabel} style={{ left: `${focusOutPct()}%` }}>
            {formatElapsedTime(props.focusDraft()!.outFrame, engine.captureDelayMs())}
          </div>
        </Show>
      </div>
    </div>
  );
}
