import { createSignal, Show, For } from "solid-js";
import type { JSX } from "solid-js";
import type { Operation } from "../../data/types";
import { Icons } from "./icons";
import { formatDuration, formatDate } from "./helpers";
import shared from "./MissionSelector.module.css";
import styles from "./dialogs.module.css";

// ─── Edit Modal ───

export function EditModal(props: {
  op: Operation;
  tags: string[];
  onClose: () => void;
  onSave: (id: string, data: { missionName?: string; tag?: string; date?: string }) => void;
}): JSX.Element {
  const [name, setName] = createSignal(props.op.missionName);
  const [tag, setTag] = createSignal(props.op.tag ?? "");
  const [date, setDate] = createSignal(props.op.date?.slice(0, 10) ?? "");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    props.onSave(props.op.id, {
      missionName: name(),
      tag: tag() || undefined,
      date: date() || undefined,
    });
  };

  const TAG_OPTIONS = ["TvT", "COOP", "Zeus", "Training", "None"];

  return (
    <div class={shared.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class={shared.modalCard} style={{ width: "420px", padding: "0" }}>
        {/* Header */}
        <div class={styles.editModalHeader}>
          <div class={styles.editModalHeaderLeft}>
            <span style={{ color: "var(--accent-blue)" }}><Icons.Edit /></span>
            <span class={styles.editModalHeaderTitle}>Edit Recording</span>
          </div>
          <button class={styles.editModalClose} onClick={props.onClose}><Icons.X /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div class={styles.editModalBody}>
            {/* Read-only info bar */}
            <div class={styles.editInfoBar}>
              <div class={styles.editInfoItem}>
                <span class={styles.editInfoKey}>ID:</span>
                <span class={styles.editInfoValue}>#{props.op.id}</span>
              </div>
              <div class={styles.editInfoItem}>
                <span class={styles.editInfoKey}>Map:</span>
                <span class={styles.editInfoValue}>{props.op.worldName}</span>
              </div>
              <Show when={props.op.storageFormat}>
                <div class={styles.editInfoItem}>
                  <span class={styles.editInfoKey}>Format:</span>
                  <span class={styles.editInfoValue}>{props.op.storageFormat}</span>
                </div>
              </Show>
              <Show when={props.op.conversionStatus}>
                <div class={styles.editInfoItem}>
                  <span class={styles.editInfoKey}>Status:</span>
                  <span class={styles.editInfoValue}>{props.op.conversionStatus === "completed" ? "Ready" : props.op.conversionStatus}</span>
                </div>
              </Show>
            </div>

            {/* Mission Name */}
            <div class={styles.editField}>
              <label class={styles.editLabel}>Mission Name</label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class={shared.modalInput}
              />
            </div>

            {/* Tag + Date side by side */}
            <div style={{ display: "flex", gap: "12px" }}>
              <div class={styles.editField} style={{ flex: "1" }}>
                <label class={styles.editLabel}>Tag</label>
                <div class={styles.editTagGroup}>
                  <For each={TAG_OPTIONS}>
                    {(t) => {
                      const val = t === "None" ? "" : t;
                      const active = () => tag() === val;
                      return (
                        <button
                          type="button"
                          class={styles.editTagBtn}
                          classList={{ [styles.editTagBtnActive]: active() }}
                          style={active() ? undefined : {
                            background: "rgba(255, 255, 255, 0.03)",
                            color: "var(--text-dimmer)",
                            "border-color": "rgba(255, 255, 255, 0.06)",
                          }}
                          onClick={() => setTag(val)}
                        >
                          {t}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            </div>

            {/* Date */}
            <div class={styles.editField}>
              <label class={styles.editLabel}>Date</label>
              <input
                type="date"
                value={date()}
                onInput={(e) => setDate(e.currentTarget.value)}
                class={shared.modalInput}
                style={{ "color-scheme": "dark" }}
              />
            </div>
          </div>

          <div class={styles.editModalFooter}>
            <button type="button" class={shared.modalCancel} onClick={props.onClose}>Cancel</button>
            <button type="submit" class={shared.modalSubmit}><Icons.Check /> Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirm ───

export function DeleteConfirm(props: {
  op: Operation;
  onClose: () => void;
  onConfirm: (id: string) => void;
}): JSX.Element {
  return (
    <div class={shared.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class={shared.modalCard} style={{ width: "420px", padding: "0" }}>
        {/* Body */}
        <div class={styles.deleteBody}>
          <div class={styles.deleteIcon}>
            <Icons.AlertTriangle />
          </div>
          <div class={styles.deleteTitle}>Delete Recording</div>
          <div class={styles.deleteSubtext}>Are you sure you want to delete</div>
          <div class={styles.deleteName}>{props.op.missionName}</div>
          <div class={styles.deleteMeta}>{formatDate(props.op.date, "en")} &middot; {formatDuration(props.op.missionDuration)}</div>
          <div class={styles.deleteWarning}>
            This will remove the database record and all associated files (.json.gz + protobuf chunks). This action cannot be undone.
          </div>
        </div>

        {/* Footer */}
        <div class={styles.editModalFooter}>
          <button type="button" class={shared.modalCancel} onClick={props.onClose}>Cancel</button>
          <button type="button" class={styles.modalSubmitDanger} onClick={() => props.onConfirm(props.op.id)}>
            <span style={{ display: "flex", "align-items": "center", gap: "5px" }}>
              <Icons.Trash /> Delete Recording
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
