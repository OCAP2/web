import type { JSX, Accessor } from "solid-js";
import { Show } from "solid-js";

export interface TopPanelProps {
  missionName: Accessor<string>;
  operationId: Accessor<string | null>;
}

/**
 * Top panel displaying the mission name and action buttons (Share, Download).
 *
 * - Share copies the current URL with `?op=<id>` to the clipboard.
 * - Download triggers a file download via the server's file endpoint.
 */
export function TopPanel(props: TopPanelProps): JSX.Element {
  const handleShare = () => {
    const id = props.operationId();
    if (!id) return;
    const url = new URL(window.location.href);
    url.searchParams.set("op", id);
    void navigator.clipboard.writeText(url.toString());
  };

  const downloadHref = () => {
    const id = props.operationId();
    if (!id) return "#";
    return `/aar/file/${encodeURIComponent(id)}`;
  };

  return (
    <div data-testid="top-panel" class="top-panel">
      <span data-testid="mission-name" class="mission-name">
        {props.missionName()}
      </span>
      <Show when={props.operationId()}>
        <button data-testid="share-button" class="share-button" onClick={handleShare}>
          Share
        </button>
        <a
          data-testid="download-button"
          class="download-button"
          href={downloadHref()}
          download=""
        >
          Download
        </a>
      </Show>
    </div>
  );
}
