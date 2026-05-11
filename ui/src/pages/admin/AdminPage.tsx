import type { JSX } from "solid-js";
import { createSignal, createMemo, createResource, Show, For, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiClient, ApiError, type AdminAuthConfig } from "../../data/apiClient";
import { useI18n } from "../../hooks/useLocale";
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  // Used by coming-soon UI that is currently commented out:
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  UsersIcon,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  FileTextIcon,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SettingsIcon,
  AlertTriangleIcon,
  LockIcon,
  PlusIcon,
  ChevronDownIcon,
  SearchIcon,
  XIcon,
  CheckIcon,
  TrashIcon,
  CopyIcon,
  SteamIcon,
  InboxIcon,
  ClipboardIcon,
} from "../../components/Icons";
import { isValidSteamId, hueFromSteamId, initialFromSteamId } from "./helpers";
import styles from "./AdminPage.module.css";

const api = new ApiClient();

type ToastKind = "success" | "warn" | "error";

interface ToastState {
  kind: ToastKind;
  message: string;
}

interface AllowlistEntry {
  steamId: string;
}

export function AdminPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [allowlist, setAllowlist] = createSignal<AllowlistEntry[]>([]);
  const [search, setSearch] = createSignal("");
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [toast, setToast] = createSignal<ToastState | null>(null);
  const [confirmSingle, setConfirmSingle] = createSignal<AllowlistEntry | null>(null);
  const [confirmBulk, setConfirmBulk] = createSignal(false);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(kind: ToastKind, message: string): void {
    if (toastTimer) clearTimeout(toastTimer);
    setToast({ kind, message });
    toastTimer = setTimeout(() => setToast(null), 4000);
  }
  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });

  const [config] = createResource<AdminAuthConfig | undefined>(async () => {
    try {
      return await api.getAdminAuthConfig();
    } catch {
      showToast("error", t("admin_toast_load_failed"));
      return undefined;
    }
  });

  const [allowlistResource] = createResource(async () => {
    try {
      const ids = await api.getAllowlist();
      const entries = ids.map((id) => ({ steamId: id }));
      setAllowlist(entries);
      return entries;
    } catch {
      showToast("error", t("admin_toast_load_failed"));
      return [];
    }
  });

  const adminIds = createMemo<string[]>(() => config()?.adminSteamIds ?? []);
  const mismatch = createMemo(() => {
    const cfg = config();
    return cfg ? cfg.mode !== "steamAllowlist" : false;
  });

  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase();
    const list = allowlist();
    if (!q) return list;
    return list.filter((e) => e.steamId.toLowerCase().includes(q));
  });

  async function handleAdd(steamId: string): Promise<void> {
    if (allowlist().some((e) => e.steamId === steamId)) {
      showToast("warn", `${steamId} ${t("admin_toast_already_present")}`);
      return;
    }
    try {
      await api.addToAllowlist(steamId);
      setAllowlist((prev) => [...prev, { steamId }]);
      showToast("success", `${t("admin_toast_added_prefix")} ${steamId} ${t("admin_toast_added_suffix")}`);
    } catch (err) {
      showToast("error", actionErrorMessage(err));
    }
  }

  async function handleBulkAdd(ids: string[]): Promise<void> {
    const existing = new Set(allowlist().map((e) => e.steamId));
    const candidates: string[] = [];
    let duplicates = 0;
    let invalid = 0;
    for (const id of ids) {
      if (!isValidSteamId(id)) {
        invalid++;
        continue;
      }
      if (existing.has(id)) {
        duplicates++;
        continue;
      }
      candidates.push(id);
      existing.add(id);
    }

    const added: string[] = [];
    let failed = 0;
    for (const id of candidates) {
      try {
        await api.addToAllowlist(id);
        added.push(id);
      } catch {
        failed++;
      }
    }
    if (added.length > 0) {
      setAllowlist((prev) => [...prev, ...added.map((id) => ({ steamId: id }))]);
    }
    showToast(
      invalid > 0 || failed > 0 ? "warn" : "success",
      bulkAddSummary(added.length, duplicates, invalid, failed),
    );
  }

  function bulkAddSummary(added: number, duplicates: number, invalid: number, failed: number): string {
    const parts = [`${t("admin_toast_added_prefix")} ${added}`];
    if (duplicates > 0) {
      const word = duplicates === 1 ? t("admin_toast_duplicate") : t("admin_toast_duplicates");
      parts.push(`${t("admin_toast_skipped")} ${duplicates} ${word}`);
    }
    if (invalid > 0) parts.push(`${invalid} ${t("admin_toast_invalid")}`);
    if (failed > 0) parts.push(`${failed} ${t("admin_toast_failed")}`);
    return parts.join(", ") + ".";
  }

  async function performRemove(entry: AllowlistEntry): Promise<void> {
    try {
      await api.removeFromAllowlist(entry.steamId);
      setAllowlist((prev) => prev.filter((e) => e.steamId !== entry.steamId));
      setSelected((prev) => {
        const next = new Set<string>(prev);
        next.delete(entry.steamId);
        return next;
      });
      showToast("success", `${t("admin_toast_removed_prefix")} ${entry.steamId}.`);
    } catch (err) {
      showToast("error", actionErrorMessage(err));
    }
  }

  function actionErrorMessage(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.detail) {
        return `${err.status} ${err.statusText} — ${err.detail}`;
      }
      return `${err.status} ${err.statusText}`;
    }
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return t("admin_toast_action_failed");
  }

  async function confirmRemoveSingle(): Promise<void> {
    const entry = confirmSingle();
    if (!entry) return;
    setConfirmSingle(null);
    await performRemove(entry);
  }

  async function confirmRemoveBulk(): Promise<void> {
    // Defensive: never remove config admins even if they somehow got into the set.
    const admins = adminIds();
    const ids = Array.from(selected()).filter((id) => !admins.includes(id));
    setConfirmBulk(false);
    const succeeded = new Set<string>();
    for (const id of ids) {
      try {
        await api.removeFromAllowlist(id);
        succeeded.add(id);
      } catch {
        // failure reported in summary; keep the row visible
      }
    }
    setAllowlist((prev) => prev.filter((e) => !succeeded.has(e.steamId)));
    setSelected((prev) => {
      const next = new Set<string>(prev);
      for (const id of succeeded) next.delete(id);
      return next;
    });
    const failed = ids.length - succeeded.size;
    const entryWord = succeeded.size === 1
      ? t("admin_toast_removed_count_singular")
      : t("admin_toast_removed_count_suffix");
    let message = `${t("admin_toast_removed_prefix")} ${succeeded.size} ${entryWord}`;
    if (failed > 0) message += ` (${failed} ${t("admin_toast_failed")})`;
    else message += ".";
    showToast(failed === 0 ? "success" : "warn", message);
  }

  function handleCopy(id: string): void {
    navigator.clipboard?.writeText(id);
    showToast("success", `${id} — ${t("admin_toast_copied")}`);
  }

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set<string>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectableFiltered = createMemo(() =>
    filtered().filter((e) => !adminIds().includes(e.steamId)),
  );

  const allFilteredSelected = createMemo(() => {
    const list = selectableFiltered();
    const sel = selected();
    return list.length > 0 && list.every((e) => sel.has(e.steamId));
  });

  function toggleAllFiltered(): void {
    const list = selectableFiltered();
    const allOn = allFilteredSelected();
    setSelected((prev) => {
      const next = new Set<string>(prev);
      for (const e of list) {
        if (allOn) next.delete(e.steamId);
        else next.add(e.steamId);
      }
      return next;
    });
  }

  function focusAddInput(): void {
    const el = document.querySelector<HTMLInputElement>(`.${styles.addInput}`);
    el?.focus();
  }

  return (
    <div class={styles.page}>
      {/* Header */}
      <header class={styles.header}>
        <div class={styles.headerTop}>
          <div class={styles.headerLeft}>
            <button
              class={styles.backBtn}
              title={t("admin_back_to_recordings")}
              onClick={() => navigate("/")}
              type="button"
            >
              <ArrowLeftIcon size={16} />
            </button>
            <div>
              <div class={styles.headerTitleRow}>
                <span class={styles.headerTitle}>OCAP</span>
                <span class={styles.headerSubtitle}>{t("admin")}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div class={styles.body}>
        {/* Sidebar */}
        <aside class={styles.sidebar}>
          <div class={styles.sidebarLabel}>{t("admin_nav_section")}</div>
          <nav class={styles.sidebarNav}>
            <div class={`${styles.sidebarItem} ${styles.sidebarItemActive}`}>
              <ShieldCheckIcon size={16} />
              <span class={styles.sidebarItemLabel}>{t("admin_nav_allowlist")}</span>
              <span class={styles.sidebarItemCount}>{allowlist().length}</span>
            </div>
            {/* Coming-soon sidebar items hidden until implemented:
              <SidebarSoonItem icon={<UsersIcon size={16} />} label={t("admin_nav_users")} soon={t("admin_nav_coming_soon")} />
              <SidebarSoonItem icon={<FileTextIcon size={16} />} label={t("admin_nav_audit")} soon={t("admin_nav_coming_soon")} />
              <SidebarSoonItem icon={<SettingsIcon size={16} />} label={t("admin_nav_settings")} soon={t("admin_nav_coming_soon")} />
            */}
          </nav>
          <div class={styles.sidebarFooter} />
        </aside>

        {/* Main */}
        <main class={styles.main}>
          <Show when={mismatch() && config()}>
            <ModeMismatchBanner mode={config()!.mode} />
          </Show>

          <Show when={config()} fallback={null}>
            <ConfigStrip config={config()!} />
          </Show>

          <Show when={!allowlistResource.loading}>
            <div class={`${styles.panel} ${mismatch() ? styles.panelDisabled : ""}`}>
              <div class={styles.panelHeader}>
                <div>
                  <div class={styles.panelTitleRow}>
                    <div class={styles.panelTitle}>{t("admin_allowlist_title")}</div>
                    <Show
                      when={!mismatch()}
                      fallback={
                        <div
                          class={styles.inactivePill}
                          title={t("admin_inactive_tooltip")}
                        >
                          {t("admin_inactive_pill")}
                        </div>
                      }
                    >
                      <div class={styles.countPill}>
                        {allowlist().length}{" "}
                        {allowlist().length === 1 ? t("admin_allowlist_count_person") : t("admin_allowlist_count_people")}
                      </div>
                    </Show>
                  </div>
                  <div class={styles.panelSubtitle}>{t("admin_allowlist_subtitle")}</div>
                </div>
              </div>

              <AddBar onAdd={handleAdd} onBulkAdd={handleBulkAdd} disabled={mismatch()} />

              <Show when={allowlist().length > 0}>
                <div class={styles.toolbar}>
                  <div class={styles.searchWrap}>
                    <div class={styles.searchIcon}>
                      <SearchIcon size={14} />
                    </div>
                    <input
                      class={styles.searchInput}
                      value={search()}
                      onInput={(e) => setSearch(e.currentTarget.value)}
                      placeholder={t("admin_search_placeholder")}
                    />
                    <Show when={search()}>
                      <button class={styles.searchClear} onClick={() => setSearch("")} type="button">
                        <XIcon size={14} />
                      </button>
                    </Show>
                  </div>

                  <button
                    class={`${styles.selectAllBtn} ${allFilteredSelected() ? styles.selectAllBtnActive : ""}`}
                    onClick={toggleAllFiltered}
                    disabled={mismatch()}
                    type="button"
                    title={mismatch() ? t("admin_inactive_tooltip") : undefined}
                  >
                    <div class={`${styles.miniCheckbox} ${allFilteredSelected() ? styles.miniCheckboxActive : ""}`}>
                      <Show when={allFilteredSelected()}>
                        <CheckIcon size={11} />
                      </Show>
                    </div>
                    <span>
                      {allFilteredSelected() ? t("admin_deselect_all") : t("admin_select_all")}
                    </span>
                  </button>

                  <div class={styles.toolbarSpacer} />

                  <Show when={selected().size > 0}>
                    <span class={styles.toolbarSelected}>
                      {selected().size} {t("admin_selected")}
                    </span>
                    <button class={styles.bulkRemove} onClick={() => setConfirmBulk(true)} type="button">
                      <TrashIcon size={13} />
                      <span>{t("admin_remove_selected")}</span>
                    </button>
                  </Show>
                </div>
              </Show>

              <div class={styles.rowList}>
                <Show
                  when={allowlist().length > 0}
                  fallback={<EmptyState onPaste={focusAddInput} />}
                >
                  <Show
                    when={filtered().length > 0}
                    fallback={
                      <div class={styles.noMatches}>
                        {t("admin_no_matches")} "{search()}"
                      </div>
                    }
                  >
                    <For each={filtered()}>
                      {(entry) => (
                        <AllowlistRow
                          entry={entry}
                          selected={selected().has(entry.steamId)}
                          isAdmin={adminIds().includes(entry.steamId)}
                          disabled={mismatch()}
                          onSelect={() => toggleOne(entry.steamId)}
                          onRemove={() => setConfirmSingle(entry)}
                          onCopy={() => handleCopy(entry.steamId)}
                        />
                      )}
                    </For>
                  </Show>
                </Show>
              </div>
            </div>
          </Show>

          {/* Future sections hidden until implemented:
            <div class={styles.comingGrid}>
              <ComingSoonCard
                icon={<UsersIcon size={16} />}
                title={t("admin_coming_users_title")}
                body={t("admin_coming_users_body")}
                soonLabel={t("admin_nav_coming_soon")}
              />
              <ComingSoonCard
                icon={<FileTextIcon size={16} />}
                title={t("admin_coming_audit_title")}
                body={t("admin_coming_audit_body")}
                soonLabel={t("admin_nav_coming_soon")}
              />
              <ComingSoonCard
                icon={<SettingsIcon size={16} />}
                title={t("admin_coming_settings_title")}
                body={t("admin_coming_settings_body")}
                soonLabel={t("admin_nav_coming_soon")}
              />
              <ComingSoonCard
                icon={<LockIcon size={16} />}
                title={t("admin_coming_tokens_title")}
                body={t("admin_coming_tokens_body")}
                soonLabel={t("admin_nav_coming_soon")}
              />
            </div>
          */}
        </main>
      </div>

      {/* Toast */}
      <Show when={toast()}>
        <ToastView toast={toast()!} onDismiss={() => setToast(null)} />
      </Show>

      {/* Confirm single */}
      <Show when={confirmSingle()}>
        <ConfirmDialog
          title={t("admin_confirm_remove_title")}
          body={
            <>
              <span class={styles.dialogBodyEmphasis}>{confirmSingle()!.steamId}</span>{" "}
              {t("admin_confirm_remove_body")}
            </>
          }
          confirmLabel={t("admin_confirm_remove")}
          cancelLabel={t("admin_confirm_cancel")}
          onCancel={() => setConfirmSingle(null)}
          onConfirm={confirmRemoveSingle}
        />
      </Show>

      {/* Confirm bulk */}
      <Show when={confirmBulk()}>
        <ConfirmDialog
          title={t("admin_confirm_bulk_title")}
          body={<>{t("admin_confirm_bulk_body")}</>}
          confirmLabel={`${t("admin_confirm_remove")} ${selected().size}`}
          cancelLabel={t("admin_confirm_cancel")}
          onCancel={() => setConfirmBulk(false)}
          onConfirm={confirmRemoveBulk}
        />
      </Show>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

/* v8 ignore start -- placeholder component for the commented-out coming-soon sidebar */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SidebarSoonItem(props: { icon: JSX.Element; label: string; soon: string }): JSX.Element {
  return (
    <div class={`${styles.sidebarItem} ${styles.sidebarItemDisabled}`}>
      {props.icon}
      <span class={styles.sidebarItemLabel}>{props.label}</span>
      <span class={styles.sidebarSoon}>{props.soon}</span>
    </div>
  );
}
/* v8 ignore stop */

function ModeMismatchBanner(props: { mode: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.mismatchBanner} role="alert">
      <div class={styles.mismatchIcon}>
        <AlertTriangleIcon size={16} />
      </div>
      <div>
        <div class={styles.mismatchTitle}>{t("admin_mismatch_title")}</div>
        <div class={styles.mismatchBody}>
          {t("admin_mismatch_body_prefix")}{" "}
          <span class={styles.mismatchInline}>{props.mode}</span>.{" "}
          {t("admin_mismatch_body_middle")}{" "}
          {t("admin_mismatch_body_suffix")}
        </div>
      </div>
    </div>
  );
}

function ConfigStrip(props: { config: AdminAuthConfig }): JSX.Element {
  const { t } = useI18n();
  const apiKeyOn = () => props.config.steamApiKeyConfigured;
  return (
    <div class={styles.configStrip}>
      <div class={styles.configHeader}>
        <div class={styles.configHeaderLeft}>
          <div class={styles.configHeaderIcon}>
            <LockIcon size={11} />
          </div>
          <div class={styles.configHeaderTitle}>{t("admin_config_title")}</div>
        </div>
        <div class={styles.configHeaderReadonly}>{t("admin_config_readonly")}</div>
      </div>

      <ConfigRow label={t("admin_config_auth_mode")}>
        <span class={styles.modePill}>{props.config.mode}</span>
      </ConfigRow>

      <ConfigRow label={t("admin_config_admin_ids")} note={t("admin_config_admin_ids_note")}>
        <For each={props.config.adminSteamIds}>
          {(id) => <span class={styles.idChip}>{id}</span>}
        </For>
      </ConfigRow>

      <ConfigRow label={t("admin_config_api_key")}>
        <span class={`${styles.apiKeyPill} ${apiKeyOn() ? styles.apiKeyPillOn : styles.apiKeyPillOff}`}>
          <span class={`${styles.apiKeyDot} ${apiKeyOn() ? styles.apiKeyDotOn : styles.apiKeyDotOff}`} />
          {apiKeyOn() ? t("admin_config_api_key_present") : t("admin_config_api_key_absent")}
        </span>
        <Show when={!apiKeyOn()}>
          <span class={styles.apiKeyFallback}>{t("admin_config_api_key_fallback")}</span>
        </Show>
      </ConfigRow>

      <ConfigRow label={t("admin_config_session_ttl")}>
        <span class={styles.idChip}>{props.config.sessionTtl}</span>
      </ConfigRow>
    </div>
  );
}

function ConfigRow(props: { label: string; note?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class={styles.configRow}>
      <div class={styles.configRowLabel}>{props.label}</div>
      <div class={styles.configRowBody}>
        <div class={styles.configRowValues}>{props.children}</div>
        <Show when={props.note}>
          <div class={styles.configRowNote}>{props.note}</div>
        </Show>
      </div>
    </div>
  );
}

function AddBar(props: {
  onAdd: (id: string) => void | Promise<void>;
  onBulkAdd: (ids: string[]) => void | Promise<void>;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [input, setInput] = createSignal("");
  const [bulkOpen, setBulkOpen] = createSignal(false);
  const [bulkText, setBulkText] = createSignal("");

  const trimmed = createMemo(() => input().trim());
  const showError = createMemo(() => trimmed().length > 0 && !isValidSteamId(trimmed()));
  const showSuccess = createMemo(() => trimmed().length > 0 && isValidSteamId(trimmed()));

  function submit(): void {
    if (!isValidSteamId(trimmed())) return;
    void props.onAdd(trimmed());
    setInput("");
  }

  function submitBulk(): void {
    const lines = bulkText().split("\n").map((l) => l.trim()).filter(Boolean);
    void props.onBulkAdd(lines);
    setBulkText("");
    setBulkOpen(false);
  }

  const disabledTitle = () => (props.disabled ? t("admin_inactive_tooltip") : undefined);

  return (
    <div class={styles.addBar}>
      <div class={styles.addRow}>
        <div class={styles.addInputWrap}>
          <input
            class={`${styles.addInput} ${showError() ? styles.addInputError : ""} ${showSuccess() ? styles.addInputSuccess : ""}`}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={t("admin_add_placeholder")}
            disabled={props.disabled}
            title={disabledTitle()}
          />
          <Show when={trimmed()}>
            <div class={`${styles.addStatusIcon} ${showSuccess() ? styles.addStatusOk : styles.addStatusErr}`}>
              <Show when={showSuccess()} fallback={<XIcon size={14} />}>
                <CheckIcon size={11} />
              </Show>
            </div>
          </Show>
        </div>
        <button
          class={styles.addBtn}
          onClick={submit}
          disabled={props.disabled || !isValidSteamId(trimmed())}
          type="button"
          title={disabledTitle()}
        >
          <PlusIcon size={14} />
          <span>{t("admin_add_button")}</span>
        </button>
        <button
          class={`${styles.bulkToggle} ${bulkOpen() ? styles.bulkToggleActive : ""}`}
          onClick={() => setBulkOpen((o) => !o)}
          disabled={props.disabled}
          type="button"
          title={disabledTitle()}
        >
          <span class={`${styles.bulkToggleChevron} ${bulkOpen() ? styles.bulkToggleChevronOpen : ""}`}>
            <ChevronDownIcon size={12} />
          </span>
          <span>{t("admin_bulk_toggle")}</span>
        </button>
      </div>

      <Show when={showError()}>
        <div class={styles.addError}>
          <AlertTriangleIcon size={12} />
          <span>{t("admin_add_invalid")}</span>
        </div>
      </Show>

      <Show when={bulkOpen()}>
        <div class={styles.bulkPanel}>
          <div class={styles.bulkPanelHeader}>
            <div class={styles.bulkPanelLabel}>{t("admin_bulk_hint")}</div>
            <div class={styles.bulkPanelCount}>
              {bulkText().split("\n").filter((l) => l.trim()).length} {t("admin_bulk_entries")}
            </div>
          </div>
          <textarea
            class={styles.bulkTextarea}
            value={bulkText()}
            onInput={(e) => setBulkText(e.currentTarget.value)}
            placeholder={"76561198012345678\n76561198087654321\n76561198023456789"}
            rows={6}
          />
          <div class={styles.bulkActions}>
            <button
              class={styles.bulkCancel}
              onClick={() => {
                setBulkOpen(false);
                setBulkText("");
              }}
              type="button"
            >
              {t("admin_confirm_cancel")}
            </button>
            <button
              class={styles.bulkSubmit}
              onClick={submitBulk}
              disabled={bulkText().trim().length === 0}
              type="button"
            >
              {t("admin_bulk_add_all")}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

function AllowlistRow(props: {
  entry: AllowlistEntry;
  selected: boolean;
  isAdmin: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onCopy: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const size = 32;
  const hue = createMemo(() => hueFromSteamId(props.entry.steamId));
  const initial = createMemo(() => initialFromSteamId(props.entry.steamId));
  const avatarStyle = createMemo(() => ({
    width: `${size}px`,
    height: `${size}px`,
    "border-radius": `${size * 0.28}px`,
    background: `linear-gradient(135deg, hsl(${hue()}, 50%, 45%), hsl(${hue()}, 50%, 30%))`,
    border: `1px solid hsla(${hue()}, 50%, 60%, 0.2)`,
    "font-size": `${Math.round(size * 0.42)}px`,
  }));

  return (
    <div class={`${styles.row} ${props.selected ? styles.rowSelected : ""}`}>
      <button
        class={`${styles.checkbox} ${props.selected ? styles.checkboxActive : ""}`}
        onClick={props.onSelect}
        disabled={props.isAdmin || props.disabled}
        type="button"
        aria-pressed={props.selected}
        title={
          props.disabled
            ? t("admin_inactive_tooltip")
            : props.isAdmin
              ? t("admin_remove_locked_tooltip")
              : undefined
        }
      >
        <Show when={props.selected}>
          <CheckIcon size={11} />
        </Show>
      </button>

      <div class={styles.avatar} style={avatarStyle()}>
        {initial()}
      </div>

      <div class={styles.rowMain}>
        <div class={styles.rowName}>
          <span class={`${styles.rowNameText} ${styles.rowNameTextDim}`}>
            {t("admin_steam_id_only")}
          </span>
          <Show when={props.isAdmin}>
            <span class={styles.adminBadge} title={t("admin_admin_badge_tooltip")}>
              <ShieldCheckIcon size={11} />
              <span>{t("admin_admin_badge")}</span>
              <span class={styles.adminBadgeMuted}>{t("admin_admin_badge_config")}</span>
            </span>
          </Show>
        </div>
        <button
          class={styles.copyBtn}
          onClick={props.onCopy}
          type="button"
          title={t("admin_copy_tooltip")}
        >
          <span>{props.entry.steamId}</span>
          <span class={styles.copyIcon}>
            <CopyIcon size={12} />
          </span>
        </button>
      </div>

      <a
        class={styles.iconLinkBtn}
        href={`https://steamcommunity.com/profiles/${props.entry.steamId}`}
        target="_blank"
        rel="noopener noreferrer"
        title={t("admin_open_steam")}
      >
        <SteamIcon size={13} />
      </a>

      <button
        class={styles.removeBtn}
        onClick={props.onRemove}
        disabled={props.isAdmin || props.disabled}
        type="button"
        title={
          props.disabled
            ? t("admin_inactive_tooltip")
            : props.isAdmin
              ? t("admin_remove_locked_tooltip")
              : t("admin_remove_tooltip")
        }
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}

function EmptyState(props: { onPaste: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.empty}>
      <div class={styles.emptyIcon}>
        <InboxIcon size={32} />
      </div>
      <div>
        <div class={styles.emptyTitle}>{t("admin_empty_title")}</div>
        <div class={styles.emptyBody}>{t("admin_empty_body")}</div>
      </div>
      <button class={styles.emptyCta} onClick={props.onPaste} type="button">
        <ClipboardIcon size={14} />
        <span>{t("admin_empty_cta")}</span>
      </button>
    </div>
  );
}

/* v8 ignore start -- placeholder component for the commented-out coming-soon grid */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ComingSoonCard(props: {
  icon: JSX.Element;
  title: string;
  body: string;
  soonLabel: string;
}): JSX.Element {
  return (
    <div class={styles.comingCard}>
      <div class={styles.comingIcon}>{props.icon}</div>
      <div>
        <div class={styles.comingHeader}>
          <div class={styles.comingTitle}>{props.title}</div>
          <span class={styles.comingPill}>{props.soonLabel}</span>
        </div>
        <div class={styles.comingBody}>{props.body}</div>
      </div>
    </div>
  );
}
/* v8 ignore stop */

function ConfirmDialog(props: {
  title: string;
  body: JSX.Element;
  confirmLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div class={styles.dialogBackdrop} onClick={props.onCancel} role="dialog" aria-modal="true">
      <div class={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div class={styles.dialogHeader}>
          <div class={`${styles.dialogHeaderIcon} ${styles.dialogHeaderIconDanger}`}>
            <AlertTriangleIcon size={16} />
          </div>
          <div class={styles.dialogTitle}>{props.title}</div>
        </div>
        <div class={styles.dialogBody}>{props.body}</div>
        <div class={styles.dialogActions}>
          <button class={styles.dialogCancel} onClick={props.onCancel} type="button">
            {props.cancelLabel}
          </button>
          <button class={styles.dialogConfirm} onClick={props.onConfirm} type="button">
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastView(props: { toast: ToastState; onDismiss: () => void }): JSX.Element {
  const variantClass = () => {
    switch (props.toast.kind) {
      case "success":
        return styles.toastSuccess;
      case "warn":
        return styles.toastWarn;
      case "error":
        return styles.toastError;
    }
  };
  const iconClass = () => {
    switch (props.toast.kind) {
      case "success":
        return styles.toastIconSuccess;
      case "warn":
        return styles.toastIconWarn;
      case "error":
        return styles.toastIconError;
    }
  };
  return (
    <div class={`${styles.toast} ${variantClass()}`} role="status">
      <div class={`${styles.toastIcon} ${iconClass()}`}>
        <Show
          when={props.toast.kind === "success"}
          fallback={<AlertTriangleIcon size={16} />}
        >
          <CheckIcon size={11} />
        </Show>
      </div>
      <div class={styles.toastMessage}>{props.toast.message}</div>
      <button class={styles.toastDismiss} onClick={props.onDismiss} type="button">
        <XIcon size={14} />
      </button>
    </div>
  );
}
