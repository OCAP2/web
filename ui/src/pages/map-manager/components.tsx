import type { JSX } from "solid-js";
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js";
import type { ToolInfo, JobInfo } from "./types";
import { PIPELINE_STAGES, STATUS_COLORS } from "./constants";
import { elapsed } from "./helpers";
import {
  CheckIcon,
  XIcon,
  SquareIcon,
  HourglassIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
} from "../../components/Icons";
import styles from "./components.module.css";

export function StatusStrip(props: {
  tools: ToolInfo[];
  jobs: JobInfo[];
  onCancel: (id: string) => void;
}): JSX.Element {
  const [openPanel, setOpenPanel] = createSignal<"tools" | "jobs" | null>(null);
  const [tick, setTick] = createSignal(0);
  let stripRef: HTMLDivElement | undefined;

  // Derived data
  const found = createMemo(() => props.tools.filter((t) => t.found).length);
  const allReqOk = createMemo(() =>
    props.tools.filter((t) => t.required).every((t) => t.found),
  );
  const missingOpt = createMemo(() =>
    props.tools.filter((t) => !t.required && !t.found),
  );
  const activeJob = createMemo(() =>
    props.jobs.find((j) => j.status === "running") ?? null,
  );
  const pending = createMemo(() =>
    props.jobs.filter((j) => j.status === "pending"),
  );
  const past = createMemo(() =>
    props.jobs.filter((j) => j.status !== "running" && j.status !== "pending"),
  );
  const currentIdx = createMemo(() =>
    activeJob()
      ? PIPELINE_STAGES.findIndex((s) => s.id === activeJob()!.stage)
      : -1,
  );

  // Tick every second while a job is active (keeps elapsed() updating)
  createEffect(() => {
    if (!activeJob()) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    onCleanup(() => clearInterval(iv));
  });

  // Close panel on outside click
  createEffect(() => {
    if (!openPanel()) return;
    const handler = (e: MouseEvent) => {
      if (stripRef && !stripRef.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener("mousedown", handler);
    onCleanup(() => document.removeEventListener("mousedown", handler));
  });

  const toggle = (panel: "tools" | "jobs") =>
    setOpenPanel((p) => (p === panel ? null : panel));

  return (
    <div ref={stripRef} class={styles.stripWrap}>
      {/* Strip bar */}
      <div class={styles.strip}>
        {/* ── Tools section ── */}
        <button
          class={styles.toolsBtn}
          classList={{ [styles.toolsBtnActive]: openPanel() === "tools" }}
          onClick={() => toggle("tools")}
        >
          <div
            class={styles.dot}
            classList={{
              [styles.dotOk]: allReqOk(),
              [styles.dotErr]: !allReqOk(),
            }}
          />
          <span
            class={styles.toolsLabel}
            classList={{
              [styles.toolsLabelOk]: allReqOk(),
              [styles.toolsLabelErr]: !allReqOk(),
            }}
          >
            {found()}/{props.tools.length} tools
          </span>
          <Show when={missingOpt().length > 0}>
            <span class={styles.degradedLabel}>
              ({missingOpt().length} optional missing)
            </span>
          </Show>
        </button>

        {/* ── Active job section ── */}
        <div class={styles.activeSection}>
          <Show
            when={activeJob()}
            fallback={<span class={styles.activeIdle}>No active imports</span>}
          >
            {(job) => (
              <>
                <div class={styles.dotPulse} />
                <span class={styles.activeWorldName}>{job().worldName}</span>

                {/* Inline stage bar */}
                <div class={styles.stageBar}>
                  <For each={PIPELINE_STAGES}>
                    {(stage, i) => {
                      const done = () => i() < currentIdx();
                      const active = () => i() === currentIdx();
                      return (
                        <div
                          class={styles.segment}
                          classList={{
                            [styles.segmentDone]: done(),
                            [styles.segmentActive]: active(),
                            [styles.segmentPending]: !done() && !active(),
                          }}
                          title={stage.label}
                        >
                          <Show when={active()}>
                            <div class={styles.segmentShimmer} />
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>

                <span class={styles.activeStageLabel}>
                  {PIPELINE_STAGES[currentIdx()]?.short || job().stage}
                </span>
                <span class={styles.activeElapsed}>
                  {void tick(), elapsed(job().startedAt)}
                </span>

                <button
                  class={styles.cancelBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCancel(job().id);
                  }}
                  title="Cancel import"
                >
                  <SquareIcon size={10} />
                </button>
              </>
            )}
          </Show>
        </div>

        {/* ── Jobs section ── */}
        <button
          class={styles.jobsBtn}
          classList={{ [styles.jobsBtnActive]: openPanel() === "jobs" }}
          onClick={() => toggle("jobs")}
        >
          <Show when={pending().length > 0}>
            <span class={styles.pendingBadge}>{pending().length}</span>
          </Show>
          <span class={styles.pastLabel}>{past().length} past</span>
          <span
            class={styles.chevron}
            classList={{ [styles.chevronOpen]: openPanel() === "jobs" }}
          >
            <ChevronDownIcon size={12} />
          </span>
        </button>
      </div>

      {/* ── Tools dropdown ── */}
      <Show when={openPanel() === "tools"}>
        <div class={`${styles.dropdown} ${styles.toolsDropdown}`}>
          <div class={styles.dropdownHeading}>CLI TOOLS</div>
          <div class={styles.toolRows}>
            <For each={props.tools}>
              {(t) => (
                <div class={styles.toolRow}>
                  <span
                    class={styles.toolIcon}
                    classList={{
                      [styles.toolFound]: t.found,
                      [styles.toolMissingReq]: !t.found && t.required,
                      [styles.toolMissingOpt]: !t.found && !t.required,
                    }}
                  >
                    {t.found ? <CheckIcon size={12} /> : <XIcon size={14} />}
                  </span>
                  <span
                    class={styles.toolName}
                    classList={{
                      [styles.toolNameFound]: t.found,
                      [styles.toolNameMissingReq]: !t.found && t.required,
                      [styles.toolNameMissingOpt]: !t.found && !t.required,
                    }}
                  >
                    {t.name}
                  </span>
                  <Show when={t.found}>
                    <span class={styles.toolPath}>{t.path}</span>
                  </Show>
                  <Show when={!t.found}>
                    <span
                      class={styles.toolLabel}
                      classList={{
                        [styles.toolLabelReq]: t.required,
                        [styles.toolLabelOpt]: !t.required,
                      }}
                    >
                      {t.required ? "required" : "optional"}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>

        </div>
      </Show>

      {/* ── Jobs dropdown ── */}
      <Show when={openPanel() === "jobs"}>
        <div class={`${styles.dropdown} ${styles.jobsDropdown}`}>
          {/* Queued */}
          <Show when={pending().length > 0}>
            <div class={styles.dropdownHeading}>QUEUED</div>
            <For each={pending()}>
              {(j) => (
                <div class={`${styles.jobRow} ${styles.jobRowPending}`}>
                  <span class={styles.jobIcon} style={{ color: "var(--text-muted)" }}>
                    <HourglassIcon size={13} />
                  </span>
                  <span class={`${styles.jobName} ${styles.jobNamePending}`}>
                    {j.worldName}
                  </span>
                  <span class={styles.jobStatusLabel} style={{ color: "var(--text-dimmer)" }}>
                    PENDING
                  </span>
                </div>
              )}
            </For>
          </Show>

          {/* History */}
          <Show when={past().length > 0}>
            <div
              class={styles.dropdownHeading}
              style={{ "margin-top": pending().length > 0 ? "10px" : "0" }}
            >
              HISTORY
            </div>
            <For each={past()}>
              {(j) => (
                <div>
                  <div
                    class={styles.jobRow}
                    classList={{
                      [styles.jobRowDone]: j.status !== "failed",
                      [styles.jobRowFailed]: j.status === "failed",
                    }}
                  >
                    <span
                      class={styles.jobIcon}
                      style={{ color: STATUS_COLORS[j.status] }}
                    >
                      {j.status === "done" ? (
                        <CheckCircleIcon size={13} />
                      ) : (
                        <XCircleIcon size={13} />
                      )}
                    </span>
                    <span class={`${styles.jobName} ${styles.jobNamePast}`}>
                      {j.worldName}
                    </span>
                    <Show when={j.finishedAt}>
                      <span class={styles.jobElapsed}>
                        {elapsed(j.startedAt, j.finishedAt)}
                      </span>
                    </Show>
                    <span
                      class={styles.jobStatusLabel}
                      style={{ color: STATUS_COLORS[j.status] }}
                    >
                      {j.status.toUpperCase()}
                    </span>
                  </div>
                  <Show when={j.status === "failed" && j.error}>
                    <div class={styles.jobError}>
                      Stage {j.stageNum}: {j.stage} — {j.error}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>

          <Show when={pending().length === 0 && past().length === 0}>
            <div class={styles.emptyJobs}>No job history</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
