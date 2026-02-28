import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import type { MapInfo } from "./types";
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
            <span class={styles.dialogTitleText}>Import Map</span>
          </div>
          <button class={styles.closeBtn} onClick={() => props.onClose()}>
            <XIcon size={14} />
          </button>
        </div>

        <div class={styles.dialogBody}>
          <p class={styles.importHint}>
            Import an Arma 3 map from a{" "}
            <a
              href="https://github.com/gruppe-adler/grad_meh"
              target="_blank"
              rel="noopener noreferrer"
              class={styles.link}
              onClick={(e) => e.stopPropagation()}
            >
              grad_meh
            </a>{" "}
            export. Package the output directory as a .zip file.
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
                    Drop <span class={styles.dropHighlight}>.zip</span> here or{" "}
                    <span class={styles.dropBrowse}>browse</span>
                  </p>
                  <span class={styles.dropLimit}>Max 2 GB</span>
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
            <div class={styles.structureTitle}>EXPECTED ZIP STRUCTURE</div>
            <div class={styles.structureList}>
              <span class={styles.structureRequired}>meta.json</span> — world metadata (required)<br />
              <span class={styles.structureRequired}>sat/</span> — satellite tiles as X/Y.png (required)<br />
              <span class={styles.structureOptional}>dem.asc.gz</span> — elevation data (optional)<br />
              <span class={styles.structureOptional}>geojson/</span> — vector feature layers (optional)<br />
              <span class={styles.structureOptional}>preview.png</span> — preview image (optional)
            </div>
          </div>
        </div>

        <div class={styles.dialogFooter}>
          <Show
            when={props.uploading}
            fallback={
              <div class={styles.footerRow}>
                <span class={styles.footerStatus} classList={{ [styles.footerStatusReady]: !!file() }}>
                  {file() ? "Ready to import" : "Select a .zip file"}
                </span>
                <div class={styles.footerActions}>
                  <button class={styles.btnCancel} onClick={() => props.onClose()}>
                    Cancel
                  </button>
                  <button
                    class={styles.btnImport}
                    disabled={!file()}
                    onClick={() => file() && props.onImport(file()!)}
                  >
                    <FilePlusIcon size={14} /> Import
                  </button>
                </div>
              </div>
            }
          >
            <div class={styles.footerUpload}>
              <div class={styles.uploadHeader}>
                <span class={styles.uploadLabel}>
                  <UploadIcon size={14} /> Uploading...
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
  return (
    <div class={styles.overlay} onClick={() => props.onClose()}>
      <div class={styles.deleteDialog} onClick={(e) => e.stopPropagation()}>
        <div class={styles.deleteBody}>
          <div class={styles.deleteIconWrap}>
            <AlertTriangleIcon size={20} />
          </div>
          <div class={styles.deleteTitle}>
            Delete {props.map.name}?
          </div>
          <p class={styles.deleteDesc}>
            This removes all tiles, styles, previews, and metadata.
            This action cannot be undone.
          </p>
        </div>
        <div class={styles.deleteFooter}>
          <button class={styles.btnCancel} onClick={() => props.onClose()}>
            Cancel
          </button>
          <button class={styles.btnDelete} onClick={() => props.onConfirm()}>
            <TrashIcon size={12} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
