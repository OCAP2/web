import { createSignal, Show, onMount } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ApiClient, type BuildInfo } from "../../data/api-client";
import styles from "./MissionModal.module.css";

export interface AboutModalProps {
  open: Accessor<boolean>;
  onClose: () => void;
}

/**
 * About/Information modal matching the old frontend's "i" button behavior.
 *
 * Shows:
 * - OCAP logo and title
 * - GitHub link
 * - Server version info (fetched from /api/version)
 * - Keyboard shortcuts
 */
export function AboutModal(props: AboutModalProps): JSX.Element {
  const [buildInfo, setBuildInfo] = createSignal<BuildInfo | null>(null);

  onMount(async () => {
    try {
      const api = new ApiClient();
      const info = await api.getVersion();
      setBuildInfo(info);
    } catch {
      // Version info not critical
    }
  });

  const serverVersion = () => {
    const info = buildInfo();
    if (!info) return "unknown";
    return info.BuildVersion || info.BuildCommit || "unknown";
  };

  return (
    <Show when={props.open()}>
      <div data-testid="about-modal" class={styles.modalOverlay} onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}>
        <div class={styles.modalBase}>
          <div class={styles.modalHeader}>
            <span>Information</span>
            <button
              data-testid="about-close-button"
              class={styles.modalButton}
              onClick={() => props.onClose()}
              style={{ "margin-left": "auto" }}
            >
              Close
            </button>
          </div>
          <div class={styles.modalBody} style={{ "min-width": "400px", "min-height": "auto" }}>
            <div style={{ padding: "15px" }}>
              <img src="/images/ocap-logo.png" height="60" alt="OCAP" />
              <h4 style={{ "line-height": "0" }}>Operation Capture And Playback</h4>
              <a href="https://github.com/OCAP2/OCAP" target="_blank">GitHub Link</a>
              <br />
              <span>Server version: {serverVersion()}</span>
              <br /><br /><br />
              <span>Space: Play / Pause</span><br />
              <span>E: Show / Hide left panel</span><br />
              <span>R: Show / Hide right panel</span>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
