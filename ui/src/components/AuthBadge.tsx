import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { useAuth } from "../hooks/useAuth";
import { useI18n } from "../hooks/useLocale";
import { SteamIcon, ShieldIcon, LogOutIcon } from "./Icons";
import styles from "./AuthBadge.module.css";

/**
 * Shared auth badge — renders Steam sign-in when unauthenticated,
 * admin badge + sign-out when authenticated.
 * Calls useAuth() internally; no props needed.
 */
export function AuthBadge(): JSX.Element {
  const { authenticated, steamName, steamId, steamAvatar, loginWithSteam, logout } = useAuth();
  const { t } = useI18n();

  return (
    <Show
      when={authenticated()}
      fallback={
        <button class={styles.signInButton} onClick={() => loginWithSteam()}>
          <SteamIcon /> {t("sign_in")}
        </button>
      }
    >
      <>
        <div class={styles.adminBadge}>
          <Show when={steamAvatar()} fallback={<div class={styles.adminAvatar}>A</div>}>
            {(url) => <img src={url()} class={styles.adminAvatarImg} alt="" data-testid="admin-avatar" />}
          </Show>
          <div>
            <div class={styles.adminName}>
              {steamName() || steamId() || "Admin"}
            </div>
            <div class={styles.adminLabel}><ShieldIcon /> ADMIN</div>
          </div>
        </div>
        <button class={styles.adminIconButton} onClick={() => logout()} title={t("sign_out")}>
          <LogOutIcon />
        </button>
      </>
    </Show>
  );
}
