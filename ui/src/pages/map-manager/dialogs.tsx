import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import type { MapInfo } from "./types";
import {
  XIcon,
  UploadIcon,
  AlertTriangleIcon,
  TrashIcon,
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

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files[0];
    if (f && f.name.toLowerCase().endsWith(".zip")) setFile(f);
  };

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) setFile(input.files[0]);
  };

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div class={styles.dialogHeader}>
          <h3>Import Map</h3>
          <button class={styles.closeBtn} onClick={props.onClose}>
            <XIcon size={18} />
          </button>
        </div>

        <div class={styles.dialogBody}>
          <div
            class={styles.dropZone}
            classList={{ [styles.dropZoneActive]: dragOver() }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Show
              when={file()}
              fallback={
                <>
                  <UploadIcon size={32} />
                  <p>Drop a grad_meh .zip file here</p>
                  <label class={styles.browseBtn}>
                    Browse
                    <input
                      type="file"
                      accept=".zip"
                      onChange={handleFileInput}
                      hidden
                    />
                  </label>
                </>
              }
            >
              <p class={styles.fileName}>{file()!.name}</p>
              <p class={styles.fileSize}>
                {(file()!.size / 1_048_576).toFixed(1)} MB
              </p>
            </Show>
          </div>

          <Show when={props.uploading}>
            <div class={styles.uploadProgress}>
              <div class={styles.uploadBar}>
                <div
                  class={styles.uploadFill}
                  style={{ width: `${props.uploadProgress}%` }}
                />
              </div>
              <span class={styles.uploadPct}>
                {Math.round(props.uploadProgress)}%
              </span>
            </div>
          </Show>
        </div>

        <div class={styles.dialogFooter}>
          <button class={styles.btnSecondary} onClick={props.onClose}>
            Cancel
          </button>
          <button
            class={styles.btnPrimary}
            disabled={!file() || props.uploading}
            onClick={() => file() && props.onImport(file()!)}
          >
            {props.uploading ? "Uploading..." : "Import"}
          </button>
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
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div class={styles.dialogHeader}>
          <h3>
            <TrashIcon size={16} /> Delete Map
          </h3>
          <button class={styles.closeBtn} onClick={props.onClose}>
            <XIcon size={18} />
          </button>
        </div>

        <div class={styles.dialogBody}>
          <div class={styles.warningBlock}>
            <AlertTriangleIcon size={20} />
            <p>
              This will permanently delete all files for{" "}
              <strong>{props.map.name}</strong> including tiles, styles, and
              metadata.
            </p>
          </div>
        </div>

        <div class={styles.dialogFooter}>
          <button class={styles.btnSecondary} onClick={props.onClose}>
            Cancel
          </button>
          <button class={styles.btnDanger} onClick={props.onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
