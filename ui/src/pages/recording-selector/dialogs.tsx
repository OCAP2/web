import { createSignal, createUniqueId, Show, For } from "solid-js";
import type { JSX } from "solid-js";
import type { Recording } from "../../data/types";
import { useI18n } from "../../hooks/useLocale";
import { EditIcon, XIcon, CheckIcon, UploadIcon, FilePlusIcon, RefreshCwIcon, AlertTriangleIcon, TrashIcon } from "../../components/Icons";
import { formatDuration, formatDate, stripRecordingExtension, isoToLocalInput, localInputToIso } from "./helpers";
import ui from "../../components/ui.module.css";
import styles from "./dialogs.module.css";

// ─── Edit Modal ───

export function EditModal(props: {
  rec: Recording;
  tags: string[];
  onClose: () => void;
  onSave: (id: string, data: { missionName?: string; tag?: string; date?: string }) => void;
}): JSX.Element {
  const { t } = useI18n();
  const tagListId = createUniqueId();
  // eslint-disable-next-line solid/reactivity -- intentional one-time init for form state
  const [name, setName] = createSignal(props.rec.missionName);
  // eslint-disable-next-line solid/reactivity -- intentional one-time init for form state
  const [tag, setTag] = createSignal(props.rec.tag ?? "");
  // eslint-disable-next-line solid/reactivity -- intentional one-time init for form state
  const [date, setDate] = createSignal(isoToLocalInput(props.rec.date));

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    props.onSave(props.rec.id, {
      missionName: name(),
      tag: tag() || undefined,
      date: localInputToIso(date()),
    });
  };

  return (
    <div class={ui.dialogOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class={ui.dialogCard} style={{ width: "420px", padding: "0" }}>
        {/* Header */}
        <div class={ui.dialogHeader}>
          <div class={styles.editModalHeaderLeft}>
            <span style={{ color: "var(--accent-primary)" }}><EditIcon /></span>
            <span class={ui.dialogTitle}>{t("edit_recording")}</span>
          </div>
          <button class={ui.dialogCloseBtn} onClick={() => props.onClose()}><XIcon /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div class={ui.dialogBody} style={{ gap: "14px" }}>
            {/* Read-only info bar */}
            <div class={styles.editInfoBar}>
              <div class={styles.editInfoItem}>
                <span class={styles.editInfoKey}>{t("id_label")}:</span>
                <span class={styles.editInfoValue}>#{props.rec.id}</span>
              </div>
              <div class={styles.editInfoItem}>
                <span class={styles.editInfoKey}>{t("map")}:</span>
                <span class={styles.editInfoValue}>{props.rec.worldName}</span>
              </div>
              <Show when={props.rec.storageFormat}>
                <div class={styles.editInfoItem}>
                  <span class={styles.editInfoKey}>{t("format_label")}:</span>
                  <span class={styles.editInfoValue}>{props.rec.storageFormat}</span>
                </div>
              </Show>
              <Show when={props.rec.conversionStatus}>
                <div class={styles.editInfoItem}>
                  <span class={styles.editInfoKey}>{t("status")}:</span>
                  <span class={styles.editInfoValue}>{props.rec.conversionStatus === "completed" ? t("ready_label") : props.rec.conversionStatus}</span>
                </div>
              </Show>
            </div>

            {/* Mission Name */}
            <div class={styles.editField}>
              <label class={styles.editLabel}>{t("name_missions")}</label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class={ui.input}
              />
            </div>

            {/* Tag */}
            <div class={styles.editField}>
              <label class={styles.editLabel}>{t("tag")}</label>
              <input
                type="text"
                value={tag()}
                onInput={(e) => setTag(e.currentTarget.value)}
                placeholder={t("placeholder_tag")}
                list={tagListId}
                class={ui.input}
              />
              <datalist id={tagListId}>
                <For each={props.tags}>
                  {(tg) => <option value={tg} />}
                </For>
              </datalist>
            </div>

            {/* Date */}
            <div class={styles.editField}>
              <label class={styles.editLabel}>{t("date")}</label>
              <input
                type="datetime-local"
                value={date()}
                onInput={(e) => setDate(e.currentTarget.value)}
                class={ui.input}
                style={{ "color-scheme": "dark" }}
              />
            </div>
          </div>

          <div class={ui.dialogFooter}>
            <button type="button" class={ui.btnGhost} onClick={() => props.onClose()}>{t("cancel")}</button>
            <button type="submit" class={ui.btnPrimary}><CheckIcon /> {t("save_changes")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Upload Dialog ───

export function UploadDialog(props: {
  maps: string[];
  tags?: string[];
  onUpload: (data: { file: File; name: string; map: string; tag: string; date: string }) => void;
  onCancel: () => void;
  uploading: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const tagListId = createUniqueId();
  const [dragOver, setDragOver] = createSignal(false);
  const [file, setFile] = createSignal<File | null>(null);
  const [name, setName] = createSignal("");
  const [map, setMap] = createSignal("");
  const [tag, setTag] = createSignal("");
  const [date, setDate] = createSignal(isoToLocalInput(new Date().toISOString()));

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
    props.onUpload({ file: f, name: name(), map: map(), tag: tag(), date: localInputToIso(date()) ?? "" });
  };

  const canSubmit = () => !!file() && !!name() && !props.uploading;

  return (
    <div class={ui.dialogOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={ui.dialogCard} style={{ width: "460px", padding: "0" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class={ui.dialogHeader}>
          <div class={styles.uploadHeaderLeft}>
            <span class={styles.uploadHeaderIcon}><UploadIcon /></span>
            <span class={ui.dialogTitle}>{t("upload_recording")}</span>
          </div>
          <button class={ui.dialogCloseBtn} data-testid="upload-dialog-close" onClick={() => props.onCancel()}><XIcon /></button>
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
                  {(() => {
                    const [beforeFormat, rest] = t("drop_recording_hint").split("{format}");
                    const [middle, afterBrowse] = (rest ?? "").split("{browse}");
                    return (
                      <>
                        {beforeFormat}<span class={styles.uploadDropHighlight}>.json.gz</span>{middle}<span class={styles.uploadDropBrowse}>{t("browse")}</span>{afterBrowse}
                      </>
                    );
                  })()}
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
            <label class={styles.editLabel}>{t("name_missions")} <span class={styles.uploadRequired}>*</span></label>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder={t("placeholder_mission_name")}
              class={ui.input}
            />
          </div>

          {/* Map / World Name */}
          <div class={styles.editField}>
            <label class={styles.editLabel}>{t("map_world_name")}</label>
            <input
              type="text"
              value={map()}
              onInput={(e) => setMap(e.currentTarget.value)}
              placeholder={t("placeholder_map_name")}
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
            <label class={styles.editLabel}>{t("tag")}</label>
            <input
              type="text"
              value={tag()}
              onInput={(e) => setTag(e.currentTarget.value)}
              placeholder={t("placeholder_tag")}
              list={tagListId}
              class={ui.input}
            />
            <datalist id={tagListId}>
              <For each={props.tags ?? []}>
                {(tg) => <option value={tg} />}
              </For>
            </datalist>
          </div>

          {/* Date */}
          <div class={styles.editField}>
            <label class={styles.editLabel}>{t("date")}</label>
            <input
              type="datetime-local"
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
            {!file() ? t("select_file_hint") : !name() ? t("enter_name_hint") : t("ready_to_upload")}
          </div>
          <div class={styles.uploadFooterButtons}>
            <button type="button" class={ui.btnGhost} onClick={() => props.onCancel()}>{t("cancel")}</button>
            <button
              class={styles.uploadSubmitBtn}
              data-testid="upload-submit"
              disabled={!canSubmit()}
              onClick={handleSubmit}
            >
              <Show when={props.uploading} fallback={<><UploadIcon /> {t("upload_recording")}</>}>
                <span style={{ display: "flex", animation: "spin 1s linear infinite" }}><RefreshCwIcon /></span> {t("uploading")}
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
  const { t, locale } = useI18n();
  return (
    <div class={ui.dialogOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class={ui.dialogCard} style={{ width: "420px", padding: "0" }}>
        {/* Body */}
        <div class={styles.deleteBody}>
          <div class={styles.deleteIcon}>
            <AlertTriangleIcon />
          </div>
          <div class={styles.deleteTitle}>{t("delete_recording")}</div>
          <div class={styles.deleteSubtext}>{t("delete_confirm_text")}</div>
          <div class={styles.deleteName}>{props.rec.missionName}</div>
          <div class={styles.deleteMeta}>{formatDate(props.rec.date, locale())} &middot; {formatDuration(props.rec.missionDuration)}</div>
          <div class={styles.deleteWarning}>
            {t("delete_recording_warning")}
          </div>
        </div>

        {/* Footer */}
        <div class={ui.dialogFooter}>
          <button type="button" class={ui.btnGhost} onClick={() => props.onClose()}>{t("cancel")}</button>
          <button type="button" class={ui.btnDanger} onClick={() => props.onConfirm(props.rec.id)}>
            <span style={{ display: "flex", "align-items": "center", gap: "5px" }}>
              <TrashIcon /> {t("delete_recording")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
