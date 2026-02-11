import { createSignal, Show, onMount, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ApiClient, type BuildInfo } from "../../data/api-client";
import { useI18n } from "../hooks/useLocale";
import { LOCALES } from "../i18n/i18n";
import type { Locale } from "../i18n/i18n";
import styles from "./MissionModal.module.css";

const LOCALE_LABELS: Record<Locale, string> = {
  ru: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
  en: "English",
  de: "Deutsch",
  cs: "\u010ce\u0161tina",
  it: "Italiano",
};

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
      <div data-testid="about-modal" class={styles.modalOverlay} onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}>
        <div class={styles.modalBase}>
          <div class={styles.modalHeader}>
            <span>{t("info")}</span>
          </div>
          <div class={styles.modalBody} style={{ "min-width": "0", "min-height": "0", padding: "10px 15px" }}>
            <img src="/images/ocap-logo.png" height="60" alt="OCAP" />
            <h4 style={{ "line-height": "0" }}>Operation Capture And Playback</h4>
            <a href="https://github.com/OCAP2/OCAP" target="_blank">GitHub Link</a>
            <br />
            <span>{t("version-server")}{serverVersion()}</span>
            <br />
            <Show when={props.extensionVersion?.()}>
              <span>{t("version-extension")}{props.extensionVersion!()}</span>
              <br />
            </Show>
            <Show when={props.addonVersion?.()}>
              <span>{t("version-addon")}{props.addonVersion!()}</span>
              <br />
            </Show>
            <br /><br />
            <span>{t("play-pause")}</span><br />
            <span>{t("show-hide-left-panel")}</span><br />
            <span>{t("show-hide-right-panel")}</span>
            <br /><br />
            <label>
              {t("language")}{" "}
              <select
                data-testid="language-select"
                value={locale()}
                onChange={(e) => setLocale(e.currentTarget.value as Locale)}
              >
                <For each={LOCALES}>
                  {(loc) => <option value={loc}>{LOCALE_LABELS[loc]}</option>}
                </For>
              </select>
            </label>
          </div>
          <div class={styles.modalFooter} style={{ "margin-top": "0", "padding": "3px 0px" }}>
            <button
              data-testid="about-close-button"
              class={styles.modalButton}
              onClick={() => props.onClose()}
            >
              {t("close")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
