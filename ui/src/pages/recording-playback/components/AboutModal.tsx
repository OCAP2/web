import { createSignal, Show, onMount, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ApiClient, type BuildInfo } from "../../../data/apiClient";
import { useI18n } from "../../../hooks/useLocale";
import { LOCALES } from "../../../i18n/i18n";
import type { Locale } from "../../../i18n/i18n";
import { LOCALE_LABELS } from "../../mission-selector/constants";
import { XIcon } from "./Icons";
import ui from "../../../components/ui.module.css";
import styles from "./AboutModal.module.css";

export interface AboutModalProps {
  open: Accessor<boolean>;
  onClose: () => void;
  extensionVersion?: Accessor<string | undefined>;
  addonVersion?: Accessor<string | undefined>;
}

export function AboutModal(props: AboutModalProps): JSX.Element {
  const [buildInfo, setBuildInfo] = createSignal<BuildInfo | null>(null);
  const { t, locale, setLocale } = useI18n();

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
      <div data-testid="about-modal" class={ui.dialogOverlay} onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}>
        <div class={ui.dialogCard} style={{ width: "340px" }}>
          {/* Header */}
          <div class={ui.dialogHeader}>
            <span class={ui.dialogTitle}>{t("info")}</span>
            <button class={ui.dialogCloseBtn} onClick={() => props.onClose()}>
              <XIcon size={14} />
            </button>
          </div>

          {/* Body */}
          <div class={styles.body}>
            <img src={`${import.meta.env.BASE_URL}ocap-logo.png`} height="48" alt="OCAP" />
            <span class={styles.appName}>Operation Capture And Playback</span>
            <a class={styles.link} href="https://github.com/OCAP2/OCAP" target="_blank">
              github.com/OCAP2/OCAP
            </a>

            {/* Versions */}
            <div class={styles.section}>
              <div class={styles.sectionLabel}>{t("versions")}</div>
              <div class={styles.row}>
                <span class={styles.rowLabel}>{t("version-server")}</span>
                <span class={styles.rowValue}>{serverVersion()}</span>
              </div>
              <Show when={props.extensionVersion?.()}>
                <div class={styles.row}>
                  <span class={styles.rowLabel}>{t("version-extension")}</span>
                  <span class={styles.rowValue}>{props.extensionVersion!()}</span>
                </div>
              </Show>
              <Show when={props.addonVersion?.()}>
                <div class={styles.row}>
                  <span class={styles.rowLabel}>{t("version-addon")}</span>
                  <span class={styles.rowValue}>{props.addonVersion!()}</span>
                </div>
              </Show>
            </div>

            {/* Shortcuts */}
            <div class={styles.section}>
              <div class={styles.sectionLabel}>{t("shortcuts")}</div>
              <div class={styles.row}>
                <kbd>Space</kbd>
                <span class={styles.rowValue}>{t("shortcut_play_pause")}</span>
              </div>
              <div class={styles.row}>
                <kbd>E</kbd>
                <span class={styles.rowValue}>{t("shortcut_toggle_panel")}</span>
              </div>
            </div>

            {/* Language */}
            <div class={styles.section}>
              <div class={styles.sectionLabel}>{t("language")}</div>
              <select
                data-testid="language-select"
                class={ui.select}
                value={locale()}
                onChange={(e) => setLocale(e.currentTarget.value as Locale)}
              >
                <For each={LOCALES}>
                  {(loc) => <option value={loc}>{LOCALE_LABELS[loc]?.label}</option>}
                </For>
              </select>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
