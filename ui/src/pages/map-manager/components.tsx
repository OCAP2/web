import type { JSX } from "solid-js";
import { createSignal, createMemo, For, Show } from "solid-js";
import type { ToolInfo, JobInfo } from "./types";
import { PIPELINE_STAGES, STATUS_COLORS } from "./constants";
import { elapsed, stageName } from "./helpers";
import {
  CheckIcon,
  XIcon,
  AlertTriangleIcon,
  SquareIcon,
  HourglassIcon,
  CheckCircleIcon,
  XCircleIcon,
  TerminalIcon,
  ClockIcon,
  ChevronDownIcon,
} from "../../components/Icons";
import styles from "./components.module.css";

// ─── ToolStatus ───

export function ToolStatus(props: { tools: ToolInfo[] }): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);

  const found = createMemo(() => props.tools.filter((t) => t.found).length);
  const allReqOk = createMemo(() =>
    props.tools.filter((t) => t.required).every((t) => t.found),
  );
  const missingOpt = createMemo(() =>
    props.tools.filter((t) => !t.required && !t.found),
  );

  return (
    <div class={styles.section}>
      <button class={styles.sectionToggle} onClick={() => setExpanded((e) => !e)}>
        <TerminalIcon size={14} />
        <span class={styles.sectionLabel}>TOOLS</span>
        <span
          class={styles.countBadge}
          classList={{
            [styles.countBadgeOk]: allReqOk(),
            [styles.countBadgeErr]: !allReqOk(),
          }}
        >
          {found()}/{props.tools.length}
        </span>
        <Show when={missingOpt().length > 0}>
          <span class={styles.optionalMissing}>
            {missingOpt().length} optional missing
          </span>
        </Show>
        <span
          class={styles.chevron}
          classList={{ [styles.chevronOpen]: expanded() }}
        >
          <ChevronDownIcon size={12} />
        </span>
      </button>

      <Show when={expanded()}>
        <div class={styles.toolGrid}>
          <For each={props.tools}>
            {(t) => (
              <div class={styles.toolItem}>
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
      </Show>
    </div>
  );
}

// ─── PipelineProgress ───

export function PipelineProgress(props: {
  job: JobInfo;
  onCancel?: (id: string) => void;
}): JSX.Element {
  const currentIdx = () => PIPELINE_STAGES.indexOf(props.job.stage || "");

  return (
    <div class={styles.pipeline}>
      <div class={styles.pipelineHeader}>
        <Show when={props.job.status === "running"}>
          <div class={styles.pipelineDot} />
        </Show>
        <span class={styles.pipelineWorld}>
          {props.job.status === "running" ? "Importing " : ""}
          {props.job.worldName}
        </span>
        <Show when={props.job.status === "running" && props.job.totalStages}>
          <span class={styles.pipelineStageCount}>
            {props.job.stageNum}/{props.job.totalStages}
          </span>
        </Show>
        <span class={styles.pipelineElapsed}>
          {elapsed(props.job.startedAt)}
        </span>
        <Show when={props.job.status === "running" && props.onCancel}>
          <button
            class={styles.cancelBtn}
            onClick={() => props.onCancel?.(props.job.id)}
            title="Cancel import"
          >
            <SquareIcon size={10} />
          </button>
        </Show>
      </div>

      <Show when={props.job.status === "running"}>
        <div class={styles.progressSegments}>
          <For each={PIPELINE_STAGES}>
            {(stage, i) => {
              const done = () => i() < currentIdx();
              const active = () => i() === currentIdx();
              return (
                <div
                  class={styles.progressSegment}
                  classList={{
                    [styles.segmentDone]: done(),
                    [styles.segmentActive]: active(),
                    [styles.segmentPending]: !done() && !active(),
                  }}
                  title={stageName(stage)}
                >
                  <Show when={active()}>
                    <div class={styles.segmentActiveBar} />
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
        <div class={styles.pipelineStageLabel}>
          {stageName(props.job.stage || "")}
        </div>
      </Show>

      <Show when={props.job.status === "failed"}>
        <div class={styles.pipelineError}>
          <AlertTriangleIcon size={14} />
          <span>{props.job.error}</span>
        </div>
      </Show>
    </div>
  );
}

// ─── JobHistory ───

export function JobHistory(props: {
  jobs: JobInfo[];
  onCancel: (id: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);

  const pending = createMemo(() =>
    props.jobs.filter((j) => j.status === "pending"),
  );
  const past = createMemo(() =>
    props.jobs.filter(
      (j) => j.status !== "running" && j.status !== "pending",
    ),
  );
  const activeJob = createMemo(() =>
    props.jobs.find((j) => j.status === "running") ?? null,
  );
  const count = createMemo(() => pending().length + past().length);

  return (
    <Show when={count() > 0 || activeJob()}>
      <div class={styles.section}>
        <button
          class={styles.sectionToggle}
          onClick={() => setExpanded((e) => !e)}
        >
          <ClockIcon size={13} />
          <span class={styles.sectionLabel}>JOBS</span>
          <Show when={pending().length > 0}>
            <span class={styles.queuedBadge}>
              {pending().length} queued
            </span>
          </Show>
          <span class={styles.pastCount}>{past().length} past</span>
          <span
            class={styles.chevron}
            classList={{ [styles.chevronOpen]: expanded() }}
          >
            <ChevronDownIcon size={12} />
          </span>
        </button>

        <Show when={expanded()}>
          <div class={styles.jobList}>
            {/* Pending/queued jobs */}
            <For each={pending()}>
              {(job) => (
                <div class={styles.jobItemPending}>
                  <span class={styles.jobIcon} style={{ color: "var(--text-muted)" }}>
                    <HourglassIcon size={13} />
                  </span>
                  <span class={styles.jobNamePending}>{job.worldName}</span>
                  <span class={styles.jobStatusBadge} style={{ color: "var(--text-muted)", background: "rgba(136,153,170,0.08)" }}>
                    QUEUED
                  </span>
                </div>
              )}
            </For>
            {/* Past jobs */}
            <For each={past()}>
              {(job) => (
                <div>
                  <div
                    class={styles.jobItem}
                    classList={{ [styles.jobItemFailed]: job.status === "failed" }}
                  >
                    <span
                      class={styles.jobIcon}
                      style={{ color: STATUS_COLORS[job.status] }}
                    >
                      {job.status === "done" ? (
                        <CheckCircleIcon size={13} />
                      ) : (
                        <XCircleIcon size={13} />
                      )}
                    </span>
                    <span class={styles.jobName}>{job.worldName}</span>
                    <Show when={job.startedAt}>
                      <span class={styles.jobElapsed}>
                        {elapsed(job.startedAt)}
                      </span>
                    </Show>
                    <span
                      class={styles.jobStatusBadge}
                      style={{
                        color: STATUS_COLORS[job.status],
                        background: `${STATUS_COLORS[job.status]}10`,
                      }}
                    >
                      {job.status.toUpperCase()}
                    </span>
                  </div>
                  <Show when={job.status === "failed" && job.error}>
                    <div class={styles.jobError}>
                      Stage {job.stageNum}: {job.stage} — {job.error}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Active running job — always visible, not inside collapsed section */}
        <Show when={activeJob()}>
          {(job) => (
            <PipelineProgress job={job()} onCancel={props.onCancel} />
          )}
        </Show>
      </div>
    </Show>
  );
}
