import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import type { MapInfo } from "./types";
import { useI18n } from "../../hooks/useLocale";
import {
  XIcon,
  UploadIcon,
  TrashIcon,
  CheckIcon,
  FilePlusIcon,
  AlertTriangleIcon,
} from "../../components/Icons";
import styles from "./dialogs.module.css";

// ─── ImportDialog ───

export function ImportDialog(props: {
  onImport: (file: File) => void;
  onClose: () => void;
  uploading: boolean;
  uploadProgress: number;
}): JSX.Element {
  const [file, setFile] = createSignal<File | null>(null);
  const [dragOver, setDragOver] = createSignal(false);
  const { t } = useI18n();
  let fileInput!: HTMLInputElement;

  const handleFile = (f: File | undefined) => {
    if (f && f.name.toLowerCase().endsWith(".zip")) setFile(f);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer?.files[0]);
  };

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    handleFile(input.files?.[0]);
  };

  return (
    <div class={styles.overlay} onClick={() => props.onClose()}>
      <div class={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div class={styles.dialogHeader}>
          <div class={styles.dialogTitleGroup}>
            <span class={styles.dialogTitleIcon}><FilePlusIcon size={16} /></span>
            <span class={styles.dialogTitleText}>{t("mm_import_map")}</span>
          </div>
          <button class={styles.closeBtn} onClick={() => props.onClose()}>
            <XIcon size={14} />
          </button>
        </div>

        <div class={styles.dialogBody}>
          <p class={styles.importHint}>
            {(() => {
              const parts = t("mm_import_hint").split("{link}");
              return (
                <>
                  {parts[0]}
                  <a
                    href="https://github.com/gruppe-adler/grad_meh"
                    target="_blank"
                    rel="noopener noreferrer"
                    class={styles.link}
                    onClick={(e) => e.stopPropagation()}
                  >
                    grad_meh
                  </a>
                  {parts[1]}
                </>
              );
            })()}
          </p>

          <input
            ref={fileInput}
            type="file"
            accept=".zip"
            onChange={handleFileInput}
            hidden
          />

          <div
            class={styles.dropZone}
            classList={{
              [styles.dropZoneActive]: dragOver(),
              [styles.dropZoneHasFile]: !!file(),
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInput.click()}
          >
            <Show
              when={file()}
              fallback={
                <>
                  <span class={styles.dropIcon}><FilePlusIcon size={28} /></span>
                  <p class={styles.dropLabel}>
                    {t("mm_drop_hint")}{" "}
                    <span class={styles.dropBrowse}>{t("mm_browse")}</span>
                  </p>
                  <span class={styles.dropLimit}>{t("mm_max_size")}</span>
                </>
              }
            >
              <div class={styles.fileRow}>
                <span class={styles.fileCheckIcon}><CheckIcon size={14} /></span>
                <div class={styles.fileInfo}>
                  <span class={styles.fileName}>{file()!.name}</span>
                  <span class={styles.fileSize}>
                    {(file()!.size / 1_048_576).toFixed(1)} MB
                  </span>
                </div>
                <button
                  class={styles.fileClearBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                >
                  <XIcon size={14} />
                </button>
              </div>
            </Show>
          </div>

          <div class={styles.structureHint}>
            <div class={styles.structureTitle}>{t("mm_expected_structure").toUpperCase()}</div>
            <div class={styles.structureList}>
              <span class={styles.structureRequired}>meta.json</span> — {t("mm_struct_meta")} ({t("mm_required")})<br />
              <span class={styles.structureRequired}>sat/</span> — {t("mm_struct_sat")} ({t("mm_required")})<br />
              <span class={styles.structureOptional}>dem.asc.gz</span> — {t("mm_struct_dem")} ({t("mm_optional")})<br />
              <span class={styles.structureOptional}>geojson/</span> — {t("mm_struct_geojson")} ({t("mm_optional")})<br />
              <span class={styles.structureOptional}>preview.png</span> — {t("mm_struct_preview")} ({t("mm_optional")})
            </div>
          </div>
        </div>

        <div class={styles.dialogFooter}>
          <Show
            when={props.uploading}
            fallback={
              <div class={styles.footerRow}>
                <span class={styles.footerStatus} classList={{ [styles.footerStatusReady]: !!file() }}>
                  {file() ? t("mm_ready_to_import") : t("mm_select_zip")}
                </span>
                <div class={styles.footerActions}>
                  <button class={styles.btnCancel} onClick={() => props.onClose()}>
                    {t("mm_cancel")}
                  </button>
                  <button
                    class={styles.btnImport}
                    disabled={!file()}
                    onClick={() => file() && props.onImport(file()!)}
                  >
                    <FilePlusIcon size={14} /> {t("mm_import")}
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles.footerUpload}>
              <div class={styles.uploadHeader}>
                <span class={styles.uploadLabel}>
                  <UploadIcon size={14} /> {t("mm_uploading")}
                </span>
                <span class={styles.uploadPct}>
                  {Math.min(100, Math.round(props.uploadProgress))}%
                </span>
              </div>
              <div class={styles.uploadBar}>
                <div
                  class={styles.uploadFill}
                  classList={{ [styles.uploadFillDone]: props.uploadProgress >= 100 }}
                  style={{ width: `${Math.min(100, props.uploadProgress)}%` }}
                />
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ─── DeleteConfirm ───

export function DeleteConfirm(props: {
  map: MapInfo;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.overlay} onClick={() => props.onClose()}>
      <div class={styles.deleteDialog} onClick={(e) => e.stopPropagation()}>
        <div class={styles.deleteBody}>
          <div class={styles.deleteIconWrap}>
            <AlertTriangleIcon size={20} />
          </div>
          <div class={styles.deleteTitle}>
            {t("mm_delete")} {props.map.name}?
          </div>
          <p class={styles.deleteDesc}>
            {t("mm_delete_warning")}
          </p>
        </div>
        <div class={styles.deleteFooter}>
          <button class={styles.btnCancel} onClick={() => props.onClose()}>
            {t("mm_cancel")}
          </button>
          <button class={styles.btnDelete} onClick={() => props.onConfirm()}>
            <TrashIcon size={12} /> {t("mm_delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
