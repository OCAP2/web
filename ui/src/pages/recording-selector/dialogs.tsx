import { createSignal, Show, For } from "solid-js";
import type { JSX } from "solid-js";
import type { Recording } from "../../data/types";
import { EditIcon, XIcon, CheckIcon, UploadIcon, FilePlusIcon, RefreshCwIcon, AlertTriangleIcon, TrashIcon } from "../../components/Icons";
import { formatDuration, formatDate, stripRecordingExtension } from "./helpers";
import { TAG_OPTIONS } from "./constants";
import ui from "../../components/ui.module.css";
import styles from "./dialogs.module.css";

// ─── Edit Modal ───

export function EditModal(props: {
  rec: Recording;
  tags: string[];
  onClose: () => void;
  onSave: (id: string, data: { missionName?: string; tag?: string; date?: string }) => void;
}): JSX.Element {
  const [name, setName] = createSignal(props.rec.missionName);
  const [tag, setTag] = createSignal(props.rec.tag ?? "");
  const [date, setDate] = createSignal(props.rec.date?.slice(0, 10) ?? "");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    props.onSave(props.rec.id, {
      missionName: name(),
      tag: tag() || undefined,
      date: date() || undefined,
    });
  };

  return (
    <div class={ui.dialogOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class={ui.dialogCard} style={{ width: "420px", padding: "0" }}>
        {/* Header */}
        <div class={ui.dialogHeader}>
          <div class={styles.editModalHeaderLeft}>
            <span style={{ color: "var(--accent-primary)" }}><EditIcon /></span>
            <span class={ui.dialogTitle}>Edit Recording</span>
          </div>
          <button class={ui.dialogCloseBtn} onClick={props.onClose}><XIcon /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div class={ui.dialogBody} style={{ gap: "14px" }}>
            {/* Read-only info bar */}
            <div class={styles.editInfoBar}>
              <div class={styles.editInfoItem}>
                <span class={styles.editInfoKey}>ID:</span>
                <span class={styles.editInfoValue}>#{props.rec.id}</span>
              </div>
              <div class={styles.editInfoItem}>
                <span class={styles.editInfoKey}>Map:</span>
                <span class={styles.editInfoValue}>{props.rec.worldName}</span>
              </div>
              <Show when={props.rec.storageFormat}>
                <div class={styles.editInfoItem}>
                  <span class={styles.editInfoKey}>Format:</span>
                  <span class={styles.editInfoValue}>{props.rec.storageFormat}</span>
                </div>
              </Show>
              <Show when={props.rec.conversionStatus}>
                <div class={styles.editInfoItem}>
                  <span class={styles.editInfoKey}>Status:</span>
                  <span class={styles.editInfoValue}>{props.rec.conversionStatus === "completed" ? "Ready" : props.rec.conversionStatus}</span>
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
                class={ui.input}
              />
            </div>

            {/* Tag + Date side by side */}
            <div style={{ display: "flex", gap: "12px" }}>
              <div class={styles.editField} style={{ flex: "1" }}>
                <label class={styles.editLabel}>Tag</label>
                <div class={styles.editTagGroup}>
                  <For each={TAG_OPTIONS}>
                    {(t) => {
                      const active = () => tag() === t;
                      return (
                        <button
                          type="button"
                          class={styles.editTagBtn}
                          classList={{ [styles.editTagBtnActive]: active() }}
                          onClick={() => setTag(t)}
                        >
                          {t || "None"}
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
                class={ui.input}
                style={{ "color-scheme": "dark" }}
              />
            </div>
          </div>

          <div class={ui.dialogFooter}>
            <button type="button" class={ui.btnGhost} onClick={props.onClose}>Cancel</button>
            <button type="submit" class={ui.btnPrimary}><CheckIcon /> Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Upload Dialog ───

export function UploadDialog(props: {
  maps: string[];
  onUpload: (data: { file: File; name: string; map: string; tag: string; date: string }) => void;
  onCancel: () => void;
  uploading: boolean;
}): JSX.Element {
  const [dragOver, setDragOver] = createSignal(false);
  const [file, setFile] = createSignal<File | null>(null);
  const [name, setName] = createSignal("");
  const [map, setMap] = createSignal("");
  const [tag, setTag] = createSignal("");
  const [date, setDate] = createSignal(new Date().toISOString().split("T")[0]);

  let fileInputRef: HTMLInputElement | undefined;

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    if (!name()) {
      setName(stripRecordingExtension(f.name));
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const handleSubmit = () => {
    const f = file();
    if (!f || !name()) return;
    props.onUpload({ file: f, name: name(), map: map(), tag: tag(), date: date() });
  };

  const canSubmit = () => !!file() && !!name() && !props.uploading;

  return (
    <div class={ui.dialogOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={ui.dialogCard} style={{ width: "460px", padding: "0" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class={ui.dialogHeader}>
          <div class={styles.uploadHeaderLeft}>
            <span class={styles.uploadHeaderIcon}><UploadIcon /></span>
            <span class={ui.dialogTitle}>Upload Recording</span>
          </div>
          <button class={ui.dialogCloseBtn} data-testid="upload-dialog-close" onClick={props.onCancel}><XIcon /></button>
        </div>

        <div class={ui.dialogBody} style={{ gap: "14px" }}>
          {/* File drop zone */}
          <div
            class={`${styles.uploadDropZone} ${dragOver() ? styles.uploadDropZoneDragOver : ""} ${file() ? styles.uploadDropZoneHasFile : ""}`}
            data-testid="upload-drop-zone"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !file() && fileInputRef?.click()}
          >
            <input
              ref={fileInputRef}
              data-testid="upload-file-input"
              type="file"
              accept=".json.gz,.json,.gz"
              style={{ display: "none" }}
              onChange={(e) => handleFile((e.currentTarget as HTMLInputElement).files?.[0])}
            />
            <Show when={file()} fallback={
              <>
                <div class={styles.uploadDropIcon}><FilePlusIcon /></div>
                <div class={styles.uploadDropText}>
                  Drop <span class={styles.uploadDropHighlight}>.json.gz</span> recording here or <span class={styles.uploadDropBrowse}>browse</span>
                </div>
              </>
            }>
              {(f) => (
                <div class={styles.uploadFileRow}>
                  <div class={styles.uploadFileIcon}><CheckIcon /></div>
                  <div class={styles.uploadFileInfo}>
                    <div class={styles.uploadFileName}>{f().name}</div>
                    <div class={styles.uploadFileSize}>{(f().size / 1024).toFixed(0)} KB</div>
                  </div>
                  <button class={styles.uploadFileRemove} data-testid="upload-file-remove" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                    <XIcon />
                  </button>
                </div>
              )}
            </Show>
          </div>

          {/* Mission Name */}
          <div class={styles.editField}>
            <label class={styles.editLabel}>MISSION NAME <span class={styles.uploadRequired}>*</span></label>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. MP_COOP_m05"
              class={ui.input}
            />
          </div>

          {/* Map / World Name */}
          <div class={styles.editField}>
            <label class={styles.editLabel}>MAP / WORLD NAME</label>
            <input
              type="text"
              value={map()}
              onInput={(e) => setMap(e.currentTarget.value)}
              placeholder="e.g. altis, tanoa, livonia"
              list="uploadMapSuggestions"
              class={ui.input}
            />
            <datalist id="uploadMapSuggestions">
              <For each={props.maps}>
                {(m) => <option value={m} />}
              </For>
            </datalist>
          </div>

          {/* Tag */}
          <div class={styles.editField}>
            <label class={styles.editLabel}>TAG</label>
            <div class={styles.editTagGroup}>
              <For each={TAG_OPTIONS}>
                {(t) => {
                  const active = () => tag() === t;
                  return (
                    <button
                      type="button"
                      class={styles.editTagBtn}
                      classList={{ [styles.editTagBtnActive]: active() }}
                      onClick={() => setTag(t)}
                    >
                      {t || "None"}
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Date */}
          <div class={styles.editField}>
            <label class={styles.editLabel}>DATE</label>
            <input
              type="date"
              value={date()}
              onInput={(e) => setDate(e.currentTarget.value)}
              class={ui.input}
              style={{ "color-scheme": "dark" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div class={styles.uploadFooter}>
          <div class={styles.uploadFooterHint}>
            {!file() ? "Select a file to upload" : !name() ? "Enter a mission name" : "Ready to upload"}
          </div>
          <div class={styles.uploadFooterButtons}>
            <button type="button" class={ui.btnGhost} onClick={props.onCancel}>Cancel</button>
            <button
              class={styles.uploadSubmitBtn}
              data-testid="upload-submit"
              disabled={!canSubmit()}
              onClick={handleSubmit}
            >
              <Show when={props.uploading} fallback={<><UploadIcon /> Upload Recording</>}>
                <span style={{ display: "flex", animation: "spin 1s linear infinite" }}><RefreshCwIcon /></span> Uploading...
              </Show>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm ───

export function DeleteConfirm(props: {
  rec: Recording;
  onClose: () => void;
  onConfirm: (id: string) => void;
}): JSX.Element {
  return (
    <div class={ui.dialogOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class={ui.dialogCard} style={{ width: "420px", padding: "0" }}>
        {/* Body */}
        <div class={styles.deleteBody}>
          <div class={styles.deleteIcon}>
            <AlertTriangleIcon />
          </div>
          <div class={styles.deleteTitle}>Delete Recording</div>
          <div class={styles.deleteSubtext}>Are you sure you want to delete</div>
          <div class={styles.deleteName}>{props.rec.missionName}</div>
          <div class={styles.deleteMeta}>{formatDate(props.rec.date, "en")} &middot; {formatDuration(props.rec.missionDuration)}</div>
          <div class={styles.deleteWarning}>
            This will remove the database record and all associated files (.json.gz + protobuf chunks). This action cannot be undone.
          </div>
        </div>

        {/* Footer */}
        <div class={ui.dialogFooter}>
          <button type="button" class={ui.btnGhost} onClick={props.onClose}>Cancel</button>
          <button type="button" class={ui.btnDanger} onClick={() => props.onConfirm(props.rec.id)}>
            <span style={{ display: "flex", "align-items": "center", gap: "5px" }}>
              <TrashIcon /> Delete Recording
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
