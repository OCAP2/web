import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { formatElapsedTime } from "../../../playback/time";
import {
  buildPopulationSamples,
  correlationStrength,
  findLowestDips,
  formatFps,
  fpsColor,
  FPS_CRITICAL,
  FPS_LOW,
  nearestIndex,
  niceScale,
  pearson,
  populationFrames,
  timeTicks,
} from "../fpsDiagnostics";
import type { PopulationKey, PopulationSample } from "../fpsDiagnostics";
import styles from "./FpsTab.module.css";
import sidePanelStyles from "./SidePanel.module.css";

// Categorical slots validated together against the panel surface (dark, adjacent
// pairs). Each entity keeps its colour whichever series are toggled off.
const FPS_SERIES_COLOR = "#3987e5";
const POPULATION_SERIES: { key: PopulationKey; labelKey: string; color: string }[] = [
  { key: "units", labelKey: "fps_units", color: "#d95926" },
  { key: "vehicles", labelKey: "fps_vehicles", color: "#199e70" },
  { key: "players", labelKey: "fps_players", color: "#c98500" },
  { key: "ai", labelKey: "fps_ai", color: "#d55181" },
];
const CRITICAL_COLOR = "#ff4a4a";
const LOW_COLOR = "#ff8a3d";
/** Ring around markers, so a dot stays legible where it crosses a line. */
const SURFACE_COLOR = "#0b1016";

/** Lowest moments closer together than this are one dip, not two. */
const DIP_GAP_SECONDS = 60;
const DIP_COUNT = 5;

// Both panes share these gutters, which is what keeps their time axes aligned.
const GUTTER_LEFT = 40;
const GUTTER_RIGHT = 14;
const PAD_TOP = 10;
const PAD_BOTTOM = 6;
const TIME_AXIS_HEIGHT = 22;
/** Fallback before the first measurement, and in test DOMs that never lay out. */
const DEFAULT_SIZE = { width: 640, height: 220 };

interface Size {
  width: number;
  height: number;
}

function createElementSize(element: Accessor<HTMLElement | undefined>): Accessor<Size> {
  const [size, setSize] = createSignal<Size>(DEFAULT_SIZE);
  onMount(() => {
    const el = element();
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  return size;
}

// ─── Chart pane ───

interface PanePoint {
  frame: number;
  value: number;
}

interface PaneSeries {
  key: string;
  color: string;
  points: PanePoint[];
  area?: boolean;
}

interface ChartPaneProps {
  label: string;
  endFrame: number;
  series: PaneSeries[];
  yMax: number;
  yTicks: number[];
  xTicks: number[];
  showTimeAxis: boolean;
  formatTime: (frame: number) => string;
  bands?: { from: number; to: number; color: string }[];
  marker?: { frame: number; value: number; label: string } | null;
  hoverFrame: number | null;
  playheadFrame: number;
  snap: (frame: number) => number;
  onHover: (frame: number | null, x: number) => void;
  onSeek: (frame: number) => void;
}

function ChartPane(props: ChartPaneProps): JSX.Element {
  let container: HTMLDivElement | undefined;
  const size = createElementSize(() => container);
  const gradientId = createUniqueId();

  const plotLeft = GUTTER_LEFT;
  const plotRight = () => Math.max(plotLeft + 10, size().width - GUTTER_RIGHT);
  const plotTop = PAD_TOP;
  const plotBottom = () =>
    Math.max(plotTop + 10, size().height - (props.showTimeAxis ? TIME_AXIS_HEIGHT : PAD_BOTTOM));

  const x = (frame: number) =>
    plotLeft + (frame / Math.max(1, props.endFrame)) * (plotRight() - plotLeft);
  const y = (value: number) =>
    plotBottom() - (Math.min(value, props.yMax) / Math.max(1e-9, props.yMax)) * (plotBottom() - plotTop);

  const linePath = (points: PanePoint[]) => {
    let path = "";
    for (let i = 0; i < points.length; i++) {
      path += `${i === 0 ? "M" : "L"}${x(points[i].frame).toFixed(1)},${y(points[i].value).toFixed(1)}`;
    }
    return path;
  };

  const areaPath = (points: PanePoint[]) => {
    if (points.length < 2) return "";
    const base = plotBottom().toFixed(1);
    return `${linePath(points)}L${x(points[points.length - 1].frame).toFixed(1)},${base}L${x(points[0].frame).toFixed(1)},${base}Z`;
  };

  const seriesFrames = createMemo(() =>
    props.series.map((series) => series.points.map((point) => point.frame)),
  );

  const hoverDots = createMemo(() => {
    const frame = props.hoverFrame;
    if (frame === null) return [];
    const frames = seriesFrames();
    return props.series.flatMap((series, i) => {
      const index = nearestIndex(frames[i], frame);
      if (index < 0) return [];
      const point = series.points[index];
      return [{ key: series.key, color: series.color, cx: x(point.frame), cy: y(point.value) }];
    });
  });

  const frameAtPointer = (event: PointerEvent): number => {
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    const px = event.clientX - rect.left;
    const ratio = (px - plotLeft) / Math.max(1, plotRight() - plotLeft);
    const raw = Math.max(0, Math.min(1, ratio)) * props.endFrame;
    return props.snap(raw);
  };

  let dragging = false;

  const handleDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragging = true;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    const frame = frameAtPointer(event);
    props.onHover(frame, x(frame));
    props.onSeek(frame);
  };

  const handleMove = (event: PointerEvent) => {
    const frame = frameAtPointer(event);
    props.onHover(frame, x(frame));
    if (dragging) props.onSeek(frame);
  };

  const handleUp = (event: PointerEvent) => {
    dragging = false;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  };

  const markerLabel = createMemo(() => {
    const marker = props.marker;
    if (!marker) return null;
    const cx = x(marker.frame);
    const cy = y(marker.value);
    const above = cy - 14 > plotTop + 4;
    let anchor: "start" | "middle" | "end" = "middle";
    if (cx < plotLeft + 36) anchor = "start";
    else if (cx > plotRight() - 36) anchor = "end";
    return { cx, cy, ty: above ? cy - 10 : cy + 18, anchor, text: marker.label };
  });

  return (
    <div ref={container} class={styles.pane}>
      <svg
        class={styles.paneSvg}
        width={size().width}
        height={size().height}
        role="img"
        aria-label={props.label}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={() => {
          if (!dragging) props.onHover(null, 0);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={FPS_SERIES_COLOR} stop-opacity="0.22" />
            <stop offset="100%" stop-color={FPS_SERIES_COLOR} stop-opacity="0.02" />
          </linearGradient>
        </defs>

        <For each={props.bands ?? []}>
          {(band) => (
            <>
              <rect
                x={plotLeft}
                y={y(band.to)}
                width={Math.max(0, plotRight() - plotLeft)}
                height={Math.max(0, y(band.from) - y(band.to))}
                fill={band.color}
                fill-opacity="0.07"
              />
              <line
                x1={plotLeft}
                x2={plotRight()}
                y1={y(band.to)}
                y2={y(band.to)}
                stroke={band.color}
                stroke-opacity="0.35"
                stroke-width="1"
              />
            </>
          )}
        </For>

        <For each={props.xTicks}>
          {(frame) => (
            <line
              class={styles.gridLine}
              x1={x(frame)}
              x2={x(frame)}
              y1={plotTop}
              y2={plotBottom()}
            />
          )}
        </For>
        <For each={props.yTicks}>
          {(value) => (
            <>
              <line
                class={value === 0 ? styles.baseLine : styles.gridLine}
                x1={plotLeft}
                x2={plotRight()}
                y1={y(value)}
                y2={y(value)}
              />
              <text class={styles.tickLabel} x={plotLeft - 6} y={y(value) + 3.5} text-anchor="end">
                {value}
              </text>
            </>
          )}
        </For>
        <Show when={props.showTimeAxis}>
          <For each={props.xTicks}>
            {(frame) => {
              const anchor = () => {
                if (x(frame) - plotLeft < 24) return "start";
                if (plotRight() - x(frame) < 24) return "end";
                return "middle";
              };
              return (
                <text class={styles.tickLabel} x={x(frame)} y={plotBottom() + 15} text-anchor={anchor()}>
                  {props.formatTime(frame)}
                </text>
              );
            }}
          </For>
        </Show>

        <For each={props.series}>
          {(series) => (
            <>
              <Show when={series.area}>
                <path d={areaPath(series.points)} fill={`url(#${gradientId})`} />
              </Show>
              <Show
                when={series.points.length > 1}
                fallback={
                  <Show when={series.points[0]}>
                    {(point) => (
                      <circle cx={x(point().frame)} cy={y(point().value)} r="3" fill={series.color} />
                    )}
                  </Show>
                }
              >
                <path
                  d={linePath(series.points)}
                  fill="none"
                  stroke={series.color}
                  // A long mission packs more samples than pixels; a 2px line
                  // then fuses its spikes into one solid band.
                  stroke-width={series.points.length > (plotRight() - plotLeft) * 0.75 ? 1.25 : 2}
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </Show>
            </>
          )}
        </For>

        <line
          class={styles.playhead}
          x1={x(props.playheadFrame)}
          x2={x(props.playheadFrame)}
          y1={plotTop - 4}
          y2={plotBottom()}
        />

        <Show when={markerLabel()}>
          {(marker) => (
            <g class={styles.marker}>
              <circle
                cx={marker().cx}
                cy={marker().cy}
                r="5"
                fill={CRITICAL_COLOR}
                stroke={SURFACE_COLOR}
                stroke-width="2"
              />
              <text
                class={styles.markerLabel}
                x={marker().cx}
                y={marker().ty}
                text-anchor={marker().anchor}
              >
                {marker().text}
              </text>
            </g>
          )}
        </Show>

        <Show when={props.hoverFrame !== null}>
          <line
            class={styles.crosshair}
            x1={x(props.hoverFrame ?? 0)}
            x2={x(props.hoverFrame ?? 0)}
            y1={plotTop}
            y2={plotBottom()}
          />
          <For each={hoverDots()}>
            {(dot) => (
              <circle
                cx={dot.cx}
                cy={dot.cy}
                r="4"
                fill={dot.color}
                stroke={SURFACE_COLOR}
                stroke-width="2"
              />
            )}
          </For>
        </Show>
      </svg>
    </div>
  );
}

// ─── Tab ───

export function FpsTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();

  const captureDelayMs = () => engine.captureDelayMs() || 1000;
  const endFrame = () => engine.endFrame();
  const formatTime = (frame: number) => formatElapsedTime(frame, captureDelayMs());

  // Events are in place before the end frame is set, so reading it here is
  // what re-runs this when a recording loads.
  const fpsSamples = createMemo(() => {
    endFrame();
    return engine.eventManager.getServerFpsSamples();
  });
  const fpsFrames = createMemo(() => fpsSamples().map((sample) => sample.frame));
  const hasFps = () => fpsSamples().length > 0;

  const stats = createMemo(() => engine.eventManager.getServerFpsStats(engine.currentFrame()));

  const dips = createMemo(() =>
    findLowestDips(
      fpsSamples(),
      DIP_COUNT,
      Math.max(1, Math.round((DIP_GAP_SECONDS * 1000) / captureDelayMs())),
    ),
  );
  const minimum = () => dips()[0];

  const sampleIntervalSeconds = createMemo(() => {
    const frames = fpsFrames();
    if (frames.length < 2) return null;
    const gaps = frames.slice(1).map((frame, i) => frame - frames[i]).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    return Math.max(1, Math.round((median * captureDelayMs()) / 1000));
  });

  // ─── Population, counted once per recording ───

  const [population, setPopulation] = createSignal<PopulationSample[] | null>(null);
  const [populationFailed, setPopulationFailed] = createSignal(false);

  createEffect(() => {
    const frames = populationFrames(fpsSamples(), endFrame(), captureDelayMs());
    setPopulation(null);
    setPopulationFailed(false);
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    untrack(() => buildPopulationSamples(engine, frames)).then(
      (samples) => {
        if (!cancelled) setPopulation(samples);
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error("Failed to count units for the FPS graph", error);
        setPopulationFailed(true);
      },
    );
  });

  const populationFramesList = createMemo(() => population()?.map((sample) => sample.frame) ?? []);
  const populationAt = (frame: number): PopulationSample | undefined => {
    const samples = population();
    if (!samples) return undefined;
    const index = nearestIndex(populationFramesList(), frame);
    return index < 0 ? undefined : samples[index];
  };
  const populationByFrame = createMemo(
    () => new Map((population() ?? []).map((sample) => [sample.frame, sample])),
  );

  const [hidden, setHidden] = createSignal<ReadonlySet<PopulationKey>>(new Set<PopulationKey>(["ai"]));
  const toggleSeries = (key: PopulationKey) => {
    const next = new Set(hidden());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
  };

  // ─── Shared hover and seek ───

  const [hoverFrame, setHoverFrame] = createSignal<number | null>(null);
  const [hoverX, setHoverX] = createSignal(0);
  let chartBody: HTMLDivElement | undefined;
  const bodySize = createElementSize(() => chartBody);

  const snap = (frame: number): number => {
    const frames = hasFps() ? fpsFrames() : populationFramesList();
    const index = nearestIndex(frames, frame);
    return index < 0 ? Math.round(frame) : frames[index];
  };
  const onHover = (frame: number | null, x: number) => {
    setHoverFrame(frame);
    setHoverX(x);
  };
  const seek = (frame: number) => engine.seekTo(frame);

  const fpsAt = (frame: number): number | undefined => {
    const index = nearestIndex(fpsFrames(), frame);
    return index < 0 ? undefined : fpsSamples()[index].fps;
  };

  /** Readout frame for the legend values: the hovered sample, else the playhead. */
  const readoutFrame = () => hoverFrame() ?? engine.currentFrame();

  // ─── Scales ───

  const xTicks = createMemo(() =>
    timeTicks(endFrame(), captureDelayMs(), Math.floor(bodySize().width / 92)),
  );

  const fpsScale = createMemo(() => {
    const max = fpsSamples().reduce((top, sample) => Math.max(top, sample.fps), 0);
    return niceScale(Math.max(max, FPS_LOW + 5), 5);
  });

  const fpsSeries = createMemo((): PaneSeries[] => [
    {
      key: "fps",
      color: FPS_SERIES_COLOR,
      area: true,
      points: fpsSamples().map((sample) => ({ frame: sample.frame, value: sample.fps })),
    },
  ]);

  const populationSeries = createMemo((): PaneSeries[] => {
    const samples = population() ?? [];
    return POPULATION_SERIES.filter((series) => !hidden().has(series.key)).map((series) => ({
      key: series.key,
      color: series.color,
      points: samples.map((sample) => ({ frame: sample.frame, value: sample[series.key] })),
    }));
  });

  const populationScale = createMemo(() => {
    let max = 0;
    for (const series of populationSeries()) {
      for (const point of series.points) max = Math.max(max, point.value);
    }
    return niceScale(Math.max(max, 4), 4);
  });

  // ─── Correlation ───

  const correlations = createMemo(() => {
    const byFrame = populationByFrame();
    if (!population() || !hasFps()) return null;
    const paired = fpsSamples().filter((sample) => byFrame.has(sample.frame));
    const fpsValues = paired.map((sample) => sample.fps);
    return {
      count: paired.length,
      rows: POPULATION_SERIES.map((series) => ({
        ...series,
        r: pearson(fpsValues, paired.map((sample) => byFrame.get(sample.frame)![series.key])),
      })),
    };
  });

  const formatR = (r: number) => `${r < 0 ? "−" : r > 0 ? "+" : ""}${Math.abs(r).toFixed(2)}`;

  // ─── Tooltip ───

  const tooltip = createMemo(() => {
    const frame = hoverFrame();
    if (frame === null) return null;
    const flip = hoverX() > bodySize().width * 0.6;
    return {
      frame,
      left: flip ? hoverX() - 12 : hoverX() + 12,
      flip,
      fps: fpsAt(frame),
      population: populationAt(frame),
    };
  });

  return (
    <div class={sidePanelStyles.tabContent}>
      <div class={styles.fpsTab}>
        <div class={styles.header}>
          <div class={`${sidePanelStyles.statsLabel} ${sidePanelStyles.serverFpsTitle}`}>
            {t("server_fps")}
          </div>
          <div class={styles.headerMeta}>
            <Show when={hasFps()}>
              <span>
                {t("fps_samples", { count: fpsSamples().length })}
                <Show when={sampleIntervalSeconds()}>
                  {(seconds) => <> · {t("fps_every", { seconds: seconds() })}</>}
                </Show>
              </span>
              <span class={styles.headerHint}>{t("fps_click_hint")}</span>
            </Show>
          </div>
        </div>

        <Show
          when={hasFps()}
          fallback={<div class={styles.note}>{t("fps_no_samples")}</div>}
        >
          <div class={styles.tiles}>
            <Show when={stats()} keyed fallback={<div class={styles.tilesPending}>—</div>}>
              {(fps) => (
                <>
                  <div class={styles.tile}>
                    <div class={styles.tileValue} style={{ color: fpsColor(fps.current) }}>
                      {formatFps(fps.current)}
                    </div>
                    <div class={styles.tileLabel}>{t("current")}</div>
                  </div>
                  <div class={styles.tile}>
                    <div class={styles.tileValue} style={{ color: fpsColor(fps.average) }}>
                      {formatFps(fps.average)}
                    </div>
                    <div class={styles.tileLabel}>{t("average")}</div>
                  </div>
                  <div class={styles.tile}>
                    <div class={styles.tileValue} style={{ color: fpsColor(fps.median) }}>
                      {formatFps(fps.median)}
                    </div>
                    <div class={styles.tileLabel}>{t("median")}</div>
                  </div>
                </>
              )}
            </Show>
            <Show when={minimum()} keyed>
              {(low) => (
                <button
                  type="button"
                  class={`${styles.tile} ${styles.tileButton}`}
                  classList={{ [styles.tileButtonActive]: engine.currentFrame() === low.frame }}
                  title={t("fps_jump_min")}
                  onClick={() => seek(low.frame)}
                >
                  <div class={styles.tileValue} style={{ color: fpsColor(low.fps) }}>
                    {formatFps(low.fps)}
                  </div>
                  <div class={styles.tileLabel}>{t("minimum")}</div>
                  <div class={styles.tileSub}>
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                    {t("fps_at", { time: formatTime(low.frame) })}
                  </div>
                </button>
              )}
            </Show>
          </div>
        </Show>

        <div class={styles.chartCard}>
          <div ref={chartBody} class={styles.chartBody} onPointerLeave={() => onHover(null, 0)}>
            <Show when={hasFps()}>
              <div class={styles.paneHeader}>
                <span class={styles.paneTitle}>{t("server_fps")}</span>
                <span class={styles.zoneKeys}>
                  <span class={styles.zoneKey}>
                    <span class={styles.zoneSwatch} style={{ background: LOW_COLOR }} />
                    {t("fps_zone_low")}
                  </span>
                  <span class={styles.zoneKey}>
                    <span class={styles.zoneSwatch} style={{ background: CRITICAL_COLOR }} />
                    {t("fps_zone_critical")}
                  </span>
                </span>
              </div>
              <div class={styles.fpsPane}>
                <ChartPane
                  label={t("fps_chart_fps")}
                  endFrame={endFrame()}
                  series={fpsSeries()}
                  yMax={fpsScale().max}
                  yTicks={fpsScale().ticks}
                  xTicks={xTicks()}
                  showTimeAxis={false}
                  formatTime={formatTime}
                  bands={[
                    { from: 0, to: FPS_CRITICAL, color: CRITICAL_COLOR },
                    { from: FPS_CRITICAL, to: FPS_LOW, color: LOW_COLOR },
                  ]}
                  marker={
                    minimum()
                      ? {
                        frame: minimum()!.frame,
                        value: minimum()!.fps,
                        label: `${t("minimum")} ${formatFps(minimum()!.fps)}`,
                      }
                      : null
                  }
                  hoverFrame={hoverFrame()}
                  playheadFrame={engine.currentFrame()}
                  snap={snap}
                  onHover={onHover}
                  onSeek={seek}
                />
              </div>
            </Show>

            <div class={styles.paneHeader}>
              <span class={styles.paneTitle}>{t("fps_population")}</span>
              <span class={styles.legend}>
                <For each={POPULATION_SERIES}>
                  {(series) => (
                    <button
                      type="button"
                      class={styles.legendChip}
                      classList={{ [styles.legendChipOff]: hidden().has(series.key) }}
                      aria-pressed={!hidden().has(series.key)}
                      onClick={() => toggleSeries(series.key)}
                    >
                      <span class={styles.lineKey} style={{ background: series.color }} />
                      <span class={styles.legendLabel}>{t(series.labelKey)}</span>
                      <span class={styles.legendValue}>
                        {populationAt(readoutFrame())?.[series.key] ?? "—"}
                      </span>
                    </button>
                  )}
                </For>
              </span>
            </div>
            <div class={styles.populationPane}>
              <ChartPane
                label={t("fps_chart_population")}
                endFrame={endFrame()}
                series={populationSeries()}
                yMax={populationScale().max}
                yTicks={populationScale().ticks}
                xTicks={xTicks()}
                showTimeAxis
                formatTime={formatTime}
                hoverFrame={hoverFrame()}
                playheadFrame={engine.currentFrame()}
                snap={snap}
                onHover={onHover}
                onSeek={seek}
              />
              <Show when={!population() || populationFailed()}>
                <div class={styles.paneOverlay}>
                  {populationFailed() ? t("fps_counts_failed") : t("fps_counting")}
                </div>
              </Show>
            </div>

            <Show when={tooltip()}>
              {(tip) => (
                <div
                  class={styles.tooltip}
                  classList={{ [styles.tooltipFlip]: tip().flip }}
                  style={{ left: `${tip().left}px` }}
                >
                  <div class={styles.tooltipTime}>{formatTime(tip().frame)}</div>
                  <Show when={tip().fps !== undefined}>
                    <div class={styles.tooltipRow}>
                      <span class={styles.lineKey} style={{ background: FPS_SERIES_COLOR }} />
                      <span class={styles.tooltipValue}>{formatFps(tip().fps!)}</span>
                      <span class={styles.tooltipLabel}>FPS</span>
                    </div>
                  </Show>
                  <For each={POPULATION_SERIES}>
                    {(series) => (
                      <div
                        class={styles.tooltipRow}
                        classList={{ [styles.tooltipRowOff]: hidden().has(series.key) }}
                      >
                        <span class={styles.lineKey} style={{ background: series.color }} />
                        <span class={styles.tooltipValue}>
                          {tip().population?.[series.key] ?? "—"}
                        </span>
                        <span class={styles.tooltipLabel}>{t(series.labelKey)}</span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>
        </div>

        <Show when={hasFps()}>
          <div class={styles.insights}>
            <div class={styles.insightCard}>
              <div class={styles.insightTitle}>{t("fps_correlation")}</div>
              <Show
                when={correlations()}
                fallback={
                  <div class={styles.insightNote}>
                    {populationFailed() ? t("fps_counts_failed") : t("fps_counting")}
                  </div>
                }
              >
                {(corr) => (
                  <>
                    <For each={corr().rows}>
                      {(row) => (
                        <div class={styles.corrRow}>
                          <span class={styles.corrName}>
                            <span class={styles.lineKey} style={{ background: row.color }} />
                            {t(row.labelKey)}
                          </span>
                          <span class={styles.corrValue}>{row.r === null ? "—" : formatR(row.r)}</span>
                          <span class={styles.corrStrength}>
                            {row.r === null ? "" : t(`fps_corr_${correlationStrength(row.r)}`)}
                          </span>
                          <span class={styles.corrTrack}>
                            <span class={styles.corrCenter} />
                            <Show when={row.r !== null}>
                              <span
                                class={styles.corrFill}
                                style={{
                                  background: row.color,
                                  left: row.r! < 0 ? `${50 + row.r! * 50}%` : "50%",
                                  width: `${Math.abs(row.r!) * 50}%`,
                                }}
                              />
                            </Show>
                          </span>
                        </div>
                      )}
                    </For>
                    <div class={styles.insightNote}>
                      {t("fps_correlation_hint")} · n = {corr().count}
                    </div>
                  </>
                )}
              </Show>
            </div>

            <div class={styles.insightCard}>
              <div class={styles.insightTitle}>{t("fps_lowest")}</div>
              <div class={`${styles.dipRow} ${styles.dipHead}`}>
                <span>#</span>
                <span>{t("fps_time")}</span>
                <span class={styles.dipNum}>FPS</span>
                <span class={styles.dipNum}>{t("fps_units")}</span>
                <span class={styles.dipNum}>{t("fps_vehicles")}</span>
                <span class={styles.dipNum}>{t("fps_players")}</span>
              </div>
              <For each={dips()}>
                {(dip, i) => {
                  const counts = () => populationByFrame().get(dip.frame);
                  return (
                    <button
                      type="button"
                      class={styles.dipRow}
                      classList={{ [styles.dipRowActive]: engine.currentFrame() === dip.frame }}
                      onClick={() => seek(dip.frame)}
                    >
                      <span class={styles.dipRank}>{i() + 1}</span>
                      <span class={styles.dipTime}>{formatTime(dip.frame)}</span>
                      <span class={`${styles.dipNum} ${styles.dipFps}`} style={{ color: fpsColor(dip.fps) }}>
                        {formatFps(dip.fps)}
                      </span>
                      <span class={styles.dipNum}>{counts()?.units ?? "—"}</span>
                      <span class={styles.dipNum}>{counts()?.vehicles ?? "—"}</span>
                      <span class={styles.dipNum}>{counts()?.players ?? "—"}</span>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
