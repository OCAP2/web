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
  /** When true, scrubber zooms into the focus range (0–100% = inFrame–outFrame). */
  constrainToFocus: Accessor<boolean>;
}

export function TimelineScrubber(props: TimelineScrubberProps): JSX.Element {
  const engine = useEngine();

  const [dragging, setDragging] = createSignal(false);
  const [hoverFrame, setHoverFrame] = createSignal<number | null>(null);
  const [draggingHandle, setDraggingHandle] = createSignal<"in" | "out" | null>(null);
  let trackRef: HTMLDivElement | undefined;
  let wasPlaying = false;

  // Effective frame range: constrained = focus range, otherwise = full recording
  const rangeStart = () => {
    if (props.constrainToFocus()) {
      const f = props.focusRange();
      return f ? f.inFrame : 0;
    }
    return 0;
  };
  const rangeEnd = () => {
    if (props.constrainToFocus()) {
      const f = props.focusRange();
      return f ? f.outFrame : engine.endFrame();
    }
    return engine.endFrame();
  };
  const rangeSpan = () => rangeEnd() - rangeStart() || 1;

  /** Map a frame to 0–100% within the effective range. */
  const frameToPct = (frame: number) =>
    ((frame - rangeStart()) / rangeSpan()) * 100;

  /** Map a 0–1 fraction from a pointer event to a frame in the effective range. */
  const pctToFrame = (pct: number) =>
    Math.round(rangeStart() + pct * rangeSpan());

  const activeFocus = () => props.editingFocus() ? props.focusDraft() : props.focusRange();
  const focusInPct = () => {
    const f = activeFocus();
    return f ? frameToPct(f.inFrame) : 0;
  };
  const focusOutPct = () => {
    const f = activeFocus();
    return f ? frameToPct(f.outFrame) : 100;
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
    const start = rangeStart();
    const end = rangeEnd();
    const span = end - start;
    if (span === 0) return { buckets: [] as HeatmapBucket[], maxVal: 1 };

    const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
      frameStart: start + (i / BUCKET_COUNT) * span,
      frameEnd: start + ((i + 1) / BUCKET_COUNT) * span,
      kills: 0,
      hits: 0,
      other: 0,
    }));

    for (const ev of engine.eventManager.getAll()) {
      if (ev.frameNum < start || ev.frameNum > end) continue;
      const idx = Math.min(Math.floor(((ev.frameNum - start) / span) * BUCKET_COUNT), BUCKET_COUNT - 1);
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

  const progress = createMemo(() => {
    const span = rangeSpan();
    return span > 0
      ? Math.max(0, Math.min(100, frameToPct(engine.currentFrame())))
      : 0;
  });

  const frameFromEvent = (e: PointerEvent): number => {
    if (!trackRef) return rangeStart();
    const rect = trackRef.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return pctToFrame(pct);
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
        props.onDraftChange({ ...d, inFrame: Math.max(0, Math.min(frame, d.outFrame - 1)) });
      } else {
        props.onDraftChange({ ...d, outFrame: Math.min(engine.endFrame(), Math.max(frame, d.inFrame + 1)) });
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

  const constrained = () => props.constrainToFocus();

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
                if (constrained()) return false; // everything visible IS the focus
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
          {(ev) => {
            const pct = () => frameToPct(ev.frameNum);
            // Hide markers outside the visible range
            if (constrained()) {
              const f = props.focusRange();
              if (f && (ev.frameNum < f.inFrame || ev.frameNum > f.outFrame)) return null;
            }
            return (
              <div
                data-testid="event-marker"
                class={styles.eventMarker}
                style={{ left: `${pct()}%` }}
              />
            );
          }}
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
            style={{ left: `${frameToPct(hoverFrame()!)}%` }}
          />
          <div
            class={styles.hoverTooltip}
            style={{ left: `${frameToPct(hoverFrame()!)}%` }}
          >
            {formatElapsedTime(hoverFrame()!, engine.captureDelayMs())}
          </div>
        </Show>

        {/* Focus dim overlays (only in unconstrained mode) */}
        <Show when={!constrained() && activeFocus()}>
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
            class={`${styles.focusHandle} ${styles.focusHandleIn}`}
            style={{ left: `${focusInPct()}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingHandle("in");
              (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture(e.pointerId);
            }}
          >
            <div class={styles.focusHandleGrip} />
          </div>
          <div
            class={`${styles.focusHandle} ${styles.focusHandleOut}`}
            style={{ left: `${focusOutPct()}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingHandle("out");
              (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture(e.pointerId);
            }}
          >
            <div class={styles.focusHandleGrip} />
          </div>
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
