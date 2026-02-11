import type { JSX, Accessor } from "solid-js";
import { Show } from "solid-js";
import styles from "./TopPanel.module.css";

export interface TopPanelProps {
  missionName: Accessor<string>;
  operationId: Accessor<string | null>;
  operationFilename?: Accessor<string | null>;
  onInfoClick?: () => void;
  onBack?: () => void;
}

/**
 * Top panel displaying the mission name and action buttons (Back, Download, Info, Share).
 *
 * - Back navigates to the mission selector.
 * - Download triggers a file download via the server's data static file endpoint.
 * - Info opens the about modal with version and shortcut info.
 * - Share copies the recording URL to the clipboard.
 */
export function TopPanel(props: TopPanelProps): JSX.Element {
  const handleShare = () => {
    const id = props.operationFilename?.() ?? props.operationId();
    if (!id) return;
    const url = new URL(window.location.origin);
    url.pathname = `/recording/${encodeURIComponent(id)}`;
    void navigator.clipboard.writeText(url.toString());
  };

  const downloadHref = () => {
    const filename = props.operationFilename?.() ?? props.operationId();
    if (!filename) return "#";
    return `data/${encodeURIComponent(filename)}.json.gz`;
  };

  return (
    <div data-testid="top-panel" class={styles.topPanel}>
      <Show when={props.onBack}>
        <div
          data-testid="back-button"
          class={`${styles.button} ${styles.backButton}`}
          title="Back"
          onClick={() => props.onBack?.()}
        />
      </Show>
      <span data-testid="mission-name" class={styles.missionName}>
        {props.missionName()}
      </span>
      <div class={styles.spacer} />
      <Show when={props.operationId()}>
        <a
          data-testid="download-button"
          class={`${styles.button} ${styles.downloadButton}`}
          title="Download"
          href={downloadHref()}
          download=""
        />
      </Show>
      <div
        data-testid="info-button"
        class={`${styles.button} ${styles.infoButton}`}
        title="Information"
        onClick={() => props.onInfoClick?.()}
      >
        i
      </div>
      <Show when={props.operationId()}>
        <div
          data-testid="share-button"
          class={`${styles.button} ${styles.shareButton}`}
          title="Share"
          onClick={handleShare}
        />
      </Show>
    </div>
  );
}
