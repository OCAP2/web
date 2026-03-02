import { createSignal, createMemo, Show, For, onMount, onCleanup, batch } from "solid-js";
import type { JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type { Recording } from "../../data/types";
import { ApiClient, type BuildInfo } from "../../data/apiClient";
import { useI18n } from "../../hooks/useLocale";
import { useCustomize } from "../../hooks/useCustomize";
import { useAuth } from "../../hooks/useAuth";
import { LOCALES } from "../../i18n/i18n";
import { LOCALE_LABELS } from "./constants";
import { GlobeIcon, UsersIcon, CrosshairIcon, ChevronDownIcon, UploadIcon, SearchIcon, TagIcon, MapIcon, XIcon, GitHubIcon, ExternalLinkIcon, HeartIcon, AlertTriangleIcon } from "../../components/Icons";
import { AuthBadge } from "../../components/AuthBadge";
import { getMapColor, isRecordingReady, stripRecordingExtension } from "./helpers";
import { StatPill, TagBadge, SortHeader } from "./components";
import { RecordingRow } from "./RecordingRow";
import { DetailSidebar } from "./DetailSidebar";
import { EditModal, DeleteConfirm, UploadDialog } from "./dialogs";
import { basePath } from "../../data/basePath";
import styles from "./RecordingSelector.module.css";

// ─── Main Component ───

export function RecordingSelector(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const api = new ApiClient();
  const customize = useCustomize();
  const { authenticated, authError, dismissAuthError } = useAuth();

  // State
  const [showUpload, setShowUpload] = createSignal(false);
  const [recordings, setRecordings] = createSignal<Recording[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [tagFilter, setTagFilter] = createSignal<string | null>(null);
  const [mapFilter, setMapFilter] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [sortBy, setSortBy] = createSignal("date");
  const [sortDir, setSortDir] = createSignal("desc");
  const [langOpen, setLangOpen] = createSignal(false);
  const [buildInfo, setBuildInfo] = createSignal<BuildInfo | null>(null);
  const [editingRec, setEditingRec] = createSignal<Recording | null>(null);
  const [deletingRec, setDeletingRec] = createSignal<Recording | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [mapToolEnabled, setMapToolEnabled] = createSignal(false);

  let searchRef: HTMLInputElement | undefined;
  let scrollRef: HTMLDivElement | undefined;

  // Fetch recordings
  onMount(async () => {
    setLoading(true);
    try {
      const [recs, info] = await Promise.all([
        api.getRecordings(),
        api.getVersion().catch(() => null),
      ]);
      setRecordings(recs.reverse());
      if (info) setBuildInfo(info);
    } catch {
      setRecordings([]);
    } finally {
      setLoading(false);
    }
    api.getMapToolTools().then(() => setMapToolEnabled(true)).catch(() => {});
  });

  // Keyboard shortcuts
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "/" && document.activeElement !== searchRef) {
      e.preventDefault();
      searchRef?.focus();
    }
    if (e.key === "Escape") {
      setSelectedId(null);
      setLangOpen(false);
      setEditingRec(null);
      setDeletingRec(null);
      searchRef?.blur();
    }
    if (e.key === "Enter" && selectedId()) {
      const rec = recordings().find((o) => o.id === selectedId());
      if (rec && isRecordingReady(rec)) handleLaunch(rec);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = filtered();
      if (list.length === 0) return;
      const currentIdx = list.findIndex((o) => o.id === selectedId());
      let nextIdx: number;
      if (e.key === "ArrowDown") {
        nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, list.length - 1);
      } else {
        nextIdx = currentIdx < 0 ? list.length - 1 : Math.max(currentIdx - 1, 0);
      }
      setSelectedId(list[nextIdx].id);
      virtualizer.scrollToIndex(nextIdx, { align: "auto" });
    }
  };

  onMount(() => window.addEventListener("keydown", handleKeydown));
  onCleanup(() => window.removeEventListener("keydown", handleKeydown));

  // Sort handler
  const handleSort = (key: string) => {
    if (sortBy() === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  // Derived data
  const uniqueMaps = createMemo(() => [...new Set(recordings().map((o) => o.worldName))].sort((a, b) => a.localeCompare(b)));
  const uniqueTags = createMemo(() => ([...new Set(recordings().map((o) => o.tag).filter(Boolean))] as string[]).sort((a, b) => a.localeCompare(b)));

  const hasPlayerData = createMemo(() => recordings().some(r => (r.playerCount ?? 0) > 0));
  const hasKillData = createMemo(() => recordings().some(r => (r.killCount ?? 0) > 0));
  const maxPlayers = createMemo(() => Math.max(0, ...recordings().map(r => r.playerCount ?? 0)));
  const totalKills = createMemo(() => recordings().reduce((s, r) => s + (r.killCount ?? 0), 0));

  const gridColumns = createMemo(() => {
    let cols = "1fr 130px 100px";
    if (hasPlayerData()) cols += " 70px";
    if (hasKillData()) cols += " 70px";
    cols += " 70px 100px 40px";
    return cols;
  });

  const filtered = createMemo(() => {
    let result = [...recordings()];
    const s = search().toLowerCase();
    if (s) {
      result = result.filter((r) =>
        r.missionName.toLowerCase().includes(s) ||
        r.worldName.toLowerCase().includes(s)
      );
    }
    const tf = tagFilter();
    if (tf) result = result.filter((r) => r.tag === tf);
    const mf = mapFilter();
    if (mf) result = result.filter((r) => r.worldName === mf);

    const sb = sortBy();
    const sd = sortDir();
    result.sort((a, b) => {
      let cmp = 0;
      switch (sb) {
        case "date": cmp = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
        case "name": cmp = a.missionName.localeCompare(b.missionName); break;
        case "duration": cmp = a.missionDuration - b.missionDuration; break;
        default: cmp = 0;
      }
      return sd === "desc" ? -cmp : cmp;
    });
    return result;
  });

  const virtualizer = createVirtualizer({
    get count() { return filtered().length; },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => 61,
    overscan: 10,
    initialRect: { width: 0, height: 800 },
  });

  const selectedRec = createMemo(() => {
    const id = selectedId();
    return id ? recordings().find((o) => o.id === id) ?? null : null;
  });

  const hasFilters = () => search() || tagFilter() || mapFilter();

  const clearFilters = () => {
    setSearch("");
    setTagFilter(null);
    setMapFilter(null);
  };

  // Launch handler
  const handleLaunch = (rec: Recording) => {
    const name = rec.filename ?? rec.id;
    navigate(`/recording/${encodeURIComponent(rec.id)}/${encodeURIComponent(name)}`, {
      state: {
        missionName: rec.missionName,
        worldName: rec.worldName,
        missionDuration: rec.missionDuration,
      },
    });
  };

  // Admin handlers
  const refreshRecordings = async () => {
    const recs = await api.getRecordings();
    setRecordings(recs.reverse());
  };

  const handleEditSave = async (id: string, data: { missionName?: string; tag?: string; date?: string }) => {
    await api.editRecording(id, data);
    setEditingRec(null);
    await refreshRecordings();
  };

  const handleDeleteConfirm = async (id: string) => {
    await api.deleteRecording(id);
    batch(() => {
      setDeletingRec(null);
      setSelectedId(null);
    });
    await refreshRecordings();
  };

  const handleRetry = async (id: string) => {
    await api.retryConversion(id);
    await refreshRecordings();
  };

  const handleUpload = async (data: { file: File; name: string; map: string; tag: string; date: string }) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", data.file);

      const baseName = stripRecordingExtension(data.file.name);
      formData.append("filename", baseName);
      formData.append("worldName", data.map || "unknown");
      formData.append("missionName", data.name);
      formData.append("missionDuration", "0");
      if (data.tag) formData.append("tag", data.tag);
      if (data.date) formData.append("date", data.date);

      await api.uploadRecording(formData);
      setShowUpload(false);
      await refreshRecordings();
    } finally {
      setUploading(false);
    }
  };

  return (
      <div data-testid="recording-selector" class={styles.page}>
        {/* ── Auth error toast ── */}
        <Show when={authError()}>
          {(msg) => <Toast message={msg()} onDismiss={() => dismissAuthError()} />}
        </Show>

        {/* ── Header ── */}
        <header class={styles.header}>
          <div class={styles.headerRow}>
            <div class={styles.logoArea}>
              <img src={`${basePath}ocap-logo.png`} height="60" alt="OCAP" />
              <Show when={customize().websiteLogo}>
                {(logo) => {
                  const img = <img src={logo()} height="60" alt="" />;
                  return customize().websiteURL
                    ? <a href={customize().websiteURL} target="_blank" rel="noopener noreferrer">{img}</a>
                    : img;
                }}
              </Show>
              <div>
                <div class={styles.titleGroup}>
                  <span class={styles.title}>{customize().headerTitle || "OCAP"}</span>
                  <Show when={!customize().headerTitle}>
                    <span class={styles.versionBadge}>v2</span>
                  </Show>
                </div>
                <div class={styles.subtitle}>
                  {customize().headerSubtitle || <>Operation Capture and Playback &middot; {recordings().length} {t("recordings")}</>}
                </div>
              </div>
            </div>

            {/* Right side: stats + language */}
            <div class={styles.statsArea}>
              <div class={styles.statPills}>
                <StatPill icon={<GlobeIcon />} value={uniqueMaps().length} label={t("maps_label")} />
                <Show when={hasPlayerData()}>
                  <StatPill icon={<UsersIcon />} value={maxPlayers()} label={t("max_players")} />
                </Show>
                <Show when={hasKillData()}>
                  <StatPill icon={<CrosshairIcon />} value={totalKills()} label={t("total_kills")} />
                </Show>
              </div>

              <div class={styles.divider} />

              {/* Language Selector */}
              <div class={styles.langSelector}>
                <button class={styles.langButton} onClick={() => setLangOpen(!langOpen())}>
                  <span class={styles.langFlag}>{LOCALE_LABELS[locale()]?.flag}</span>
                  <span class={styles.langLabel}>{LOCALE_LABELS[locale()]?.label}</span>
                  <span class={`${styles.langChevron} ${langOpen() ? styles.langChevronOpen : ""}`}>
                    <ChevronDownIcon />
                  </span>
                </button>
                <Show when={langOpen()}>
                  <div class={styles.langOverlay} onClick={() => setLangOpen(false)} />
                  <div class={styles.langDropdown}>
                    <div class={styles.langDropdownTitle}>{t("language_label")}</div>
                    <For each={LOCALES}>
                      {(loc) => (
                        <button
                          class={`${styles.langOption} ${locale() === loc ? styles.langOptionActive : ""}`}
                          onClick={() => { setLocale(loc); setLangOpen(false); }}
                        >
                          <span class={styles.langOptionFlag}>{LOCALE_LABELS[loc]?.flag}</span>
                          <span class={`${styles.langOptionLabel} ${locale() === loc ? styles.langOptionLabelActive : ""}`}>
                            {LOCALE_LABELS[loc]?.label}
                          </span>
                          <Show when={locale() === loc}>
                            <span class={styles.langOptionCheck}>{"\u2713"}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div class={styles.divider} />

              <div class={styles.adminArea}>
                <AuthBadge />
                <Show when={authenticated()}>
                  <Show when={mapToolEnabled()}>
                    <button
                      class={styles.adminIconButton}
                      onClick={() => navigate("/map-manager")}
                      title="Map Manager"
                    >
                      <GlobeIcon />
                    </button>
                  </Show>
                  <button
                    class={`${styles.adminIconButton} ${showUpload() ? styles.adminIconButtonActive : ""}`}
                    onClick={() => setShowUpload(u => !u)}
                    title="Upload recording"
                  >
                    <UploadIcon />
                  </button>
                </Show>
              </div>
            </div>
          </div>

          {/* ── Filter bar ── */}
          <div class={styles.filterBar}>
            {/* Search */}
            <div class={styles.searchWrap}>
              <span class={styles.searchIcon}><SearchIcon /></span>
              <input
                ref={searchRef}
                data-testid="search-input"
                type="text"
                placeholder={t("search_placeholder")}
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class={styles.searchInput}
              />
              <kbd class={styles.searchKbd}>/</kbd>
            </div>

            {/* Tag filters */}
            <div class={styles.tagFilters}>
              <span class={styles.tagIcon}><TagIcon /></span>
              <For each={uniqueTags()}>
                {(tag) => (
                  <TagBadge
                    tag={tag}
                    clickable
                    active={tagFilter() === null || tagFilter() === tag}
                    onClick={() => setTagFilter(tagFilter() === tag ? null : tag)}
                    data-testid={`tag-filter-${tag}`}
                  />
                )}
              </For>
            </div>

            {/* Map filters */}
            <Show when={uniqueMaps().length > 1}>
              <div class={styles.mapFilters}>
                <span class={styles.mapIcon}><MapIcon /></span>
                <For each={uniqueMaps()}>
                  {(mapName) => {
                    const color = getMapColor(mapName);
                    const active = () => mapFilter() === null || mapFilter() === mapName;
                    return (
                      <button
                        class={styles.mapButton}
                        data-testid={`map-filter-${mapName}`}
                        style={{
                          background: active() ? `${color}18` : "rgba(255,255,255,0.02)",
                          color: active() ? color : "var(--text-dimmer)",
                          border: `1px solid ${active() ? color + "30" : "rgba(255,255,255,0.05)"}`,
                        }}
                        onClick={() => setMapFilter(mapFilter() === mapName ? null : mapName)}
                      >
                        <div class={styles.mapDot} style={{ background: active() ? color : "var(--text-dimmer)" }} />
                        {mapName}
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Clear */}
            <Show when={hasFilters()}>
              <button class={styles.clearButton} data-testid="clear-filters" onClick={clearFilters}>
                <XIcon /> {t("clear")}
              </button>
            </Show>
          </div>
        </header>

        {/* ── Upload Dialog (modal) ── */}
        <Show when={showUpload() && authenticated()}>
          <UploadDialog
            maps={uniqueMaps()}
            onUpload={handleUpload}
            onCancel={() => setShowUpload(false)}
            uploading={uploading()}
          />
        </Show>

        {/* ── Main Content ── */}
        <div class={styles.mainContent}>
          <div class={styles.tableArea}>
            {/* Column Headers */}
            <div class={styles.tableHeader} style={{ "grid-template-columns": gridColumns() }}>
              <SortHeader label={t("recording")} sortKey="name" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <SortHeader label={t("data")} sortKey="date" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <SortHeader label={t("durability")} sortKey="duration" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <Show when={hasPlayerData()}>
                <span class={styles.colLabel}>{t("players")}</span>
              </Show>
              <Show when={hasKillData()}>
                <span class={styles.colLabel}>{t("total_kills")}</span>
              </Show>
              <span class={styles.colLabel}>{t("tag")}</span>
              <span class={styles.colLabelRight}>{t("status")}</span>
              <span />
            </div>

            {/* Rows */}
            <div ref={scrollRef} class={styles.tableBody} data-testid="recordings-list">
              <Show when={loading()}>
                <div data-testid="loading-indicator" style={{
                  display: "flex", "align-items": "center", "justify-content": "center",
                  padding: "40px", color: "var(--text-dim)", "font-family": "var(--font-mono)",
                  "font-size": "12px",
                }}>
                  {t("loading")}
                </div>
              </Show>
              <Show when={!loading() && filtered().length === 0}>
                <div class={styles.emptyState}>
                  <SearchIcon />
                  <span class={styles.emptyText}>{t("no_recordings_found")}</span>
                  <span class={styles.emptyHint}>{t("adjust_filters")}</span>
                </div>
              </Show>
              <div class={styles.virtualContainer} style={{ height: `${virtualizer.getTotalSize()}px` }}>
                <For each={virtualizer.getVirtualItems()}>
                  {(vItem) => {
                    const rec = () => filtered()[vItem.index];
                    return (
                      <Show when={rec()}>
                        {(o) => (
                          <div class={styles.virtualRow} style={{ height: `${vItem.size}px`, transform: `translateY(${vItem.start}px)` }}>
                            <RecordingRow
                              rec={o()}
                              selected={selectedId() === o().id}
                              onSelect={setSelectedId}
                              onLaunch={handleLaunch}
                              index={vItem.index}
                              showPlayers={hasPlayerData()}
                              showKills={hasKillData()}
                              gridColumns={gridColumns()}
                            />
                          </div>
                        )}
                      </Show>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* Footer */}
            <div class={styles.footer}>
              <div class={styles.footerLeft}>
                <a href="https://github.com/OCAP2/OCAP" target="_blank" rel="noopener noreferrer" class={styles.footerGithub}>
                  <GitHubIcon />
                  <span>OCAP2</span>
                  <ExternalLinkIcon />
                </a>
                <div class={styles.dividerShort} />
                <Show when={buildInfo()}>
                  {(info) => (
                    <div class={styles.footerVersions}>
                      <span class={styles.footerVersion}>
                        <span class={styles.footerVersionValue}>{info().BuildVersion}</span>
                      </span>
                      <span class={styles.footerVersion}>
                        <span class={styles.footerVersionValue}>{info().BuildCommit}</span>
                      </span>
                      <span class={styles.footerVersion}>
                        <span class={styles.footerVersionValue}>{info().BuildDate}</span>
                      </span>
                    </div>
                  )}
                </Show>
                <div class={styles.dividerShort} />
                <span class={styles.footerMadeWith}>
                  <span class={styles.footerHeart}><HeartIcon /></span> {t("made_with_love")}
                </span>
              </div>
              <span class={styles.footerCenter}>
                {filtered().length} {t("of")} {recordings().length} {t("recordings")}
              </span>
              <div class={styles.footerRight}>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>{"\u2191\u2193"}</kbd>
                  <span class={styles.footerAction}>{t("navigate")}</span>
                </div>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>Enter</kbd>
                  <span class={styles.footerAction}>{t("open_shortcut")}</span>
                </div>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>Esc</kbd>
                  <span class={styles.footerAction}>{t("deselect")}</span>
                </div>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>/</kbd>
                  <span class={styles.footerAction}>{t("search_shortcut")}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Detail Sidebar ── */}
          <Show when={selectedRec()}>
            {(rec) => (
              <DetailSidebar
                rec={rec()}
                onLaunch={handleLaunch}
                onClose={() => setSelectedId(null)}
                isAdmin={authenticated()}
                onEdit={setEditingRec}
                onDelete={setDeletingRec}
                onRetry={handleRetry}
              />
            )}
          </Show>
        </div>

        {/* ── Edit Modal ── */}
        <Show when={editingRec()}>
          {(rec) => (
            <EditModal
              rec={rec()}
              tags={uniqueTags()}
              onClose={() => setEditingRec(null)}
              onSave={handleEditSave}
            />
          )}
        </Show>

        {/* ── Delete Confirm ── */}
        <Show when={deletingRec()}>
          {(rec) => (
            <DeleteConfirm
              rec={rec()}
              onClose={() => setDeletingRec(null)}
              onConfirm={handleDeleteConfirm}
            />
          )}
        </Show>
      </div>
  );
}

// ─── Toast notification ───

function Toast(props: { message: string; onDismiss: () => void }): JSX.Element {
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    timer = setTimeout(() => props.onDismiss(), 5000);
  });

  onCleanup(() => clearTimeout(timer));

  return (
    <div class={styles.toast} data-testid="auth-toast">
      <AlertTriangleIcon />
      <span>{props.message}</span>
      <button class={styles.toastClose} onClick={() => props.onDismiss()} data-testid="auth-toast-dismiss">
        <XIcon />
      </button>
    </div>
  );
}

