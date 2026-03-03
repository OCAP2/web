import type { JSX } from "solid-js";
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js";
import type { ToolInfo, HealthCheck, JobInfo } from "./types";
import { PIPELINE_STAGES, STATUS_COLORS } from "./constants";
import { elapsed } from "./helpers";
import { useI18n } from "../../hooks/useLocale";
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
  health: HealthCheck[];
  jobs: JobInfo[];
  onCancel: (id: string) => void;
}): JSX.Element {
  const { t } = useI18n();
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
  const healthOk = createMemo(() =>
    props.health.every((h) => h.ok),
  );
  const failedJobs = createMemo(() =>
    props.jobs.filter((j) => j.status === "failed").length,
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
              [styles.dotOk]: allReqOk() && healthOk(),
              [styles.dotErr]: !allReqOk() || !healthOk(),
            }}
          />
          <span
            class={styles.toolsLabel}
            classList={{
              [styles.toolsLabelOk]: allReqOk() && healthOk(),
              [styles.toolsLabelErr]: !allReqOk() || !healthOk(),
            }}
          >
            {found()}/{props.tools.length} {t("mm_tools")}
          </span>
          <Show when={!healthOk()}>
            <span class={styles.healthErrLabel}>
              {t("mm_env_issue")}
            </span>
          </Show>
          <Show when={healthOk() && missingOpt().length > 0}>
            <span class={styles.degradedLabel}>
              ({missingOpt().length} {t("mm_optional_missing")})
            </span>
          </Show>
        </button>

        {/* ── Active job section ── */}
        <div class={styles.activeSection}>
          <Show
            when={activeJob()}
            fallback={<span class={styles.activeIdle}>{t("mm_no_active_imports")}</span>}
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
                  {(void tick(), elapsed(job().startedAt))}
                </span>

                <button
                  class={styles.cancelBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCancel(job().id);
                  }}
                  title={t("mm_cancel_import")}
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
          <Show when={failedJobs() > 0}>
            <span class={styles.failedBadge}>{failedJobs()}</span>
          </Show>
          <span
            class={styles.pastLabel}
            classList={{ [styles.pastLabelFailed]: failedJobs() > 0 }}
          >
            {past().length} {t("mm_past")}
          </span>
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
          <div class={styles.dropdownHeading}>{t("mm_cli_tools")}</div>
          <div class={styles.toolRows}>
            <For each={props.tools}>
              {(tool) => (
                <div class={styles.toolRow}>
                  <span
                    class={styles.toolIcon}
                    classList={{
                      [styles.toolFound]: tool.found,
                      [styles.toolMissingReq]: !tool.found && tool.required,
                      [styles.toolMissingOpt]: !tool.found && !tool.required,
                    }}
                  >
                    {tool.found ? <CheckIcon size={12} /> : <XIcon size={14} />}
                  </span>
                  <span
                    class={styles.toolName}
                    classList={{
                      [styles.toolNameFound]: tool.found,
                      [styles.toolNameMissingReq]: !tool.found && tool.required,
                      [styles.toolNameMissingOpt]: !tool.found && !tool.required,
                    }}
                  >
                    {tool.name}
                  </span>
                  <Show when={tool.found}>
                    <span class={styles.toolPath}>{tool.path}</span>
                  </Show>
                  <Show when={!tool.found}>
                    <span
                      class={styles.toolLabel}
                      classList={{
                        [styles.toolLabelReq]: tool.required,
                        [styles.toolLabelOpt]: !tool.required,
                      }}
                    >
                      {tool.required ? t("mm_required") : t("mm_optional")}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>

          <Show when={props.health.length > 0}>
            <div class={styles.healthSection}>
              <div class={styles.dropdownHeading}>{t("mm_environment")}</div>
              <For each={props.health}>
                {(h) => (
                  <div>
                    <div class={styles.toolRow}>
                      <span
                        class={styles.toolIcon}
                        classList={{
                          [styles.toolFound]: h.ok,
                          [styles.toolMissingReq]: !h.ok,
                        }}
                      >
                        {h.ok ? <CheckIcon size={12} /> : <XIcon size={14} />}
                      </span>
                      <span
                        class={styles.toolName}
                        classList={{
                          [styles.toolNameFound]: h.ok,
                          [styles.toolNameMissingReq]: !h.ok,
                        }}
                      >
                        {h.label}
                      </span>
                    </div>
                    <Show when={!h.ok && h.error}>
                      <div class={styles.healthError}>{h.error}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>

        </div>
      </Show>

      {/* ── Jobs dropdown ── */}
      <Show when={openPanel() === "jobs"}>
        <div class={`${styles.dropdown} ${styles.jobsDropdown}`}>
          {/* Queued */}
          <Show when={pending().length > 0}>
            <div class={styles.dropdownHeading}>{t("mm_queued")}</div>
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
                    {t("mm_pending")}
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
              {t("mm_history")}
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
            <div class={styles.emptyJobs}>{t("mm_no_job_history")}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
