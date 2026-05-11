import { Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { useAuth } from "../hooks/useAuth";
import { useI18n } from "../hooks/useLocale";
import { SteamIcon, ShieldIcon, LogOutIcon } from "./Icons";
import styles from "./AuthBadge.module.css";

/**
 * Shared auth badge — renders login controls when unauthenticated,
 * admin badge + sign-out when authenticated.
 * Shows password form in password mode, Steam button in all other modes.
 * Calls useAuth() internally; no props needed.
 */
export function AuthBadge(): JSX.Element {
  const { authenticated, isAdmin, steamName, steamId, steamAvatar, authMode, authError, dismissAuthError, loginWithSteam, loginWithPassword, logout } = useAuth();
  const { t } = useI18n();
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  const handlePasswordSubmit = async (e: Event) => {
    e.preventDefault();
    if (!password()) return;
    setLoading(true);
    try {
      await loginWithPassword(password());
    } finally {
      setLoading(false);
      setPassword("");
    }
  };

  return (
    <Show
      when={authenticated()}
      fallback={
        <div class={styles.authControls}>
          <Show when={authMode() === "password"}>
            <form onSubmit={handlePasswordSubmit} class={styles.passwordForm}>
              <input
                type="password"
                placeholder={t("password_placeholder")}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class={styles.passwordInput}
                disabled={loading()}
              />
              <button type="submit" class={styles.passwordSubmit} disabled={loading() || !password()}>
                {t("password_unlock")}
              </button>
            </form>
          </Show>
          <button class={styles.signInButton} onClick={() => loginWithSteam()}>
            <SteamIcon /> {t("sign_in")}
          </button>
          <Show when={authError()}>
            <div class={styles.authError}>
              {authError()}
              <button class={styles.dismissError} onClick={dismissAuthError}>x</button>
            </div>
          </Show>
        </div>
      }
    >
      <>
        <div class={styles.adminBadge}>
          <Show when={steamAvatar()} fallback={<div class={styles.adminAvatar}>{(steamName() || "U")[0].toUpperCase()}</div>}>
            {(url) => <img src={url()} class={styles.adminAvatarImg} alt="" data-testid="admin-avatar" />}
          </Show>
          <div>
            <div class={styles.adminName}>
              {steamName() || steamId() || "User"}
            </div>
            <Show when={isAdmin()}>
              <div class={styles.adminLabel}><ShieldIcon /> ADMIN</div>
            </Show>
          </div>
        </div>
        <button class={styles.adminIconButton} onClick={() => logout()} title={t("sign_out")}>
          <LogOutIcon />
        </button>
      </>
    </Show>
  );
}
