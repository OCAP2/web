import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import type { ToolInfo, JobInfo } from "./types";
import { STATUS_COLORS } from "./constants";
import { elapsed, stageName } from "./helpers";
import {
  CheckIcon,
  XIcon,
  AlertTriangleIcon,
} from "../../components/Icons";
import styles from "./components.module.css";

// ─── ToolStatus ───

export function ToolStatus(props: { tools: ToolInfo[] }): JSX.Element {
  return (
    <div class={styles.toolGrid}>
      <For each={props.tools}>
        {(t) => (
          <div
            class={styles.toolItem}
            classList={{ [styles.toolMissing]: !t.found }}
          >
            <span class={styles.toolIcon}>
              {t.found ? <CheckIcon size={14} /> : <XIcon size={14} />}
            </span>
            <span class={styles.toolName}>{t.name}</span>
            <Show when={!t.found && t.required}>
              <span class={styles.toolRequired}>required</span>
            </Show>
            <Show when={!t.found && !t.required}>
              <span class={styles.toolOptional}>optional</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

// ─── PipelineProgress ───

export function PipelineProgress(props: { job: JobInfo }): JSX.Element {
  const pct = () => {
    const j = props.job;
    if (!j.totalStages || j.totalStages === 0) return 0;
    return Math.round((j.stageNum! / j.totalStages) * 100);
  };

  return (
    <div class={styles.pipeline}>
      <div class={styles.pipelineHeader}>
        <span class={styles.pipelineWorld}>{props.job.worldName}</span>
        <span
          class={styles.pipelineStatus}
          style={{ color: STATUS_COLORS[props.job.status] }}
        >
          {props.job.status}
        </span>
      </div>
      <Show when={props.job.status === "running"}>
        <div class={styles.progressBar}>
          <div class={styles.progressFill} style={{ width: `${pct()}%` }} />
        </div>
        <div class={styles.pipelineDetail}>
          <span>
            {props.job.stageNum}/{props.job.totalStages}{" "}
            {stageName(props.job.stage || "")}
          </span>
          <span>{elapsed(props.job.startedAt)}</span>
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
  return (
    <div class={styles.jobList}>
      <For each={props.jobs}>
        {(job) => (
          <div class={styles.jobItem}>
            <PipelineProgress job={job} />
            <Show
              when={job.status === "running" || job.status === "pending"}
            >
              <button
                class={styles.cancelBtn}
                onClick={() => props.onCancel(job.id)}
              >
                Cancel
              </button>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
