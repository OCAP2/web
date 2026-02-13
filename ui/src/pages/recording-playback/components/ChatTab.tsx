import type { JSX } from "solid-js";
import { useI18n } from "../../../hooks/useLocale";
import styles from "./SidePanel.module.css";

export function ChatTab(): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.tabContent}>
      <div class={styles.placeholder}>
        {t("chat_unavailable")}
      </div>
    </div>
  );
}
