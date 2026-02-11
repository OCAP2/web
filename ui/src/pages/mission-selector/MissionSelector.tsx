import { createSignal, createMemo, Show, For, onMount, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { Operation } from "../../data/types";
import { ApiClient, type BuildInfo } from "../../data/api-client";
import { useI18n } from "../../ui/hooks/useLocale";
import { LOCALES } from "../../ui/i18n/i18n";
import { LOCALE_LABELS } from "./constants";
import { Icons } from "./icons";
import { formatDuration, getMapColor, isOpReady } from "./helpers";
import { OcapLogoSvg } from "./OcapLogoSvg";
import { StatPill, TagBadge, SortHeader } from "./components";
import { MissionRow } from "./MissionRow";
import { DetailSidebar } from "./DetailSidebar";
import styles from "./MissionSelector.module.css";

// ─── Main Component ───

export function MissionSelector(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const api = new ApiClient();

  // State
  const [operations, setOperations] = createSignal<Operation[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [tagFilter, setTagFilter] = createSignal<string | null>(null);
  const [mapFilter, setMapFilter] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [sortBy, setSortBy] = createSignal("date");
  const [sortDir, setSortDir] = createSignal("desc");
  const [launched, setLaunched] = createSignal<Operation | null>(null);
  const [langOpen, setLangOpen] = createSignal(false);
  const [buildInfo, setBuildInfo] = createSignal<BuildInfo | null>(null);

  let searchRef: HTMLInputElement | undefined;

  // Fetch operations
  onMount(async () => {
    setLoading(true);
    try {
      const [ops, info] = await Promise.all([
        api.getOperations(),
        api.getVersion().catch(() => null),
      ]);
      setOperations(ops.reverse());
      if (info) setBuildInfo(info);
    } catch {
      setOperations([]);
    } finally {
      setLoading(false);
    }
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
      searchRef?.blur();
    }
    if (e.key === "Enter" && selectedId()) {
      const op = operations().find((o) => o.id === selectedId());
      if (op && isOpReady(op)) handleLaunch(op);
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
  const uniqueMaps = createMemo(() => [...new Set(operations().map((o) => o.worldName))]);
  const uniqueTags = createMemo(() => [...new Set(operations().map((o) => o.tag).filter(Boolean))] as string[]);

  const filtered = createMemo(() => {
    let result = [...operations()];
    const s = search().toLowerCase();
    if (s) {
      result = result.filter((op) =>
        op.missionName.toLowerCase().includes(s) ||
        op.worldName.toLowerCase().includes(s)
      );
    }
    const tf = tagFilter();
    if (tf) result = result.filter((op) => op.tag === tf);
    const mf = mapFilter();
    if (mf) result = result.filter((op) => op.worldName === mf);

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

  const selectedOp = createMemo(() => {
    const id = selectedId();
    return id ? operations().find((o) => o.id === id) ?? null : null;
  });

  const serverVersion = () => {
    const info = buildInfo();
    if (!info) return "—";
    return info.BuildVersion || info.BuildCommit || "—";
  };

  const hasFilters = () => search() || tagFilter() || mapFilter();

  const clearFilters = () => {
    setSearch("");
    setTagFilter(null);
    setMapFilter(null);
  };

  // Launch handler
  const handleLaunch = (op: Operation) => {
    setLaunched(op);
    setTimeout(() => {
      const id = op.filename ?? op.id;
      navigate(`/recording/${encodeURIComponent(id)}`);
    }, 2000);
  };

  // ── Loading transition ──
  const launchedOp = () => launched();
  return (
    <Show when={!launchedOp()} fallback={
      <div class={styles.loadingScreen} data-testid="loading-screen">
        <div class={styles.loadingContent}>
          <div class={styles.loadingLogo}>
            <OcapLogoSvg size={56} />
          </div>
          <div class={styles.loadingTitle}>Loading {launchedOp()!.missionName}</div>
          <div class={styles.loadingSubtitle}>{launchedOp()!.worldName} &middot; {formatDuration(launchedOp()!.missionDuration)}</div>
          <div class={styles.loadingBarTrack}>
            <div class={styles.loadingBarFill} />
          </div>
          <div class={styles.loadingHint}>Initializing replay engine...</div>
        </div>
      </div>
    }>
      <div data-testid="mission-selector" class={styles.page}>
        {/* ── Header ── */}
        <header class={styles.header}>
          <div class={styles.headerRow}>
            <div class={styles.logoArea}>
              <div class={styles.logoWrap}>
                <OcapLogoSvg />
              </div>
              <div>
                <div class={styles.titleGroup}>
                  <span class={styles.title}>OCAP</span>
                  <span class={styles.versionBadge}>v2</span>
                </div>
                <div class={styles.subtitle}>
                  Operation Capture and Playback &middot; {operations().length} {t("recordings")}
                </div>
              </div>
            </div>

            {/* Right side: stats + language */}
            <div class={styles.statsArea}>
              <div class={styles.statPills}>
                <StatPill icon={<Icons.Globe />} value={uniqueMaps().length} label={t("maps_label")} />
                {/* Uncomment when data is available
                <StatPill icon={<Icons.Users />} value={"\u2014"} label={t("max_players")} />
                <StatPill icon={<Icons.Crosshair />} value={"\u2014"} label={t("total_kills")} />
                */}
              </div>

              <div class={styles.divider} />

              {/* Language Selector */}
              <div class={styles.langSelector}>
                <button class={styles.langButton} onClick={() => setLangOpen(!langOpen())}>
                  <span class={styles.langFlag}>{LOCALE_LABELS[locale()]?.flag}</span>
                  <span class={styles.langLabel}>{LOCALE_LABELS[locale()]?.label}</span>
                  <span class={`${styles.langChevron} ${langOpen() ? styles.langChevronOpen : ""}`}>
                    <Icons.ChevronDown />
                  </span>
                </button>
                <Show when={langOpen()}>
                  <div class={styles.langOverlay} onClick={() => setLangOpen(false)} />
                  <div class={styles.langDropdown}>
                    <div class={styles.langDropdownTitle}>LANGUAGE</div>
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
            </div>
          </div>

          {/* ── Filter bar ── */}
          <div class={styles.filterBar}>
            {/* Search */}
            <div class={styles.searchWrap}>
              <span class={styles.searchIcon}><Icons.Search /></span>
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
              <span class={styles.tagIcon}><Icons.Tag /></span>
              <For each={uniqueTags()}>
                {(tag) => (
                  <TagBadge
                    tag={tag}
                    clickable
                    active={tagFilter() === null || tagFilter() === tag}
                    onClick={() => setTagFilter(tagFilter() === tag ? null : tag)}
                  />
                )}
              </For>
            </div>

            {/* Map filters */}
            <Show when={uniqueMaps().length > 1}>
              <div class={styles.mapFilters}>
                <span class={styles.mapIcon}><Icons.Map /></span>
                <For each={uniqueMaps()}>
                  {(mapName) => {
                    const color = getMapColor(mapName);
                    const active = () => mapFilter() === null || mapFilter() === mapName;
                    return (
                      <button
                        class={styles.mapButton}
                        style={{
                          background: active() ? `${color}18` : "rgba(255,255,255,0.02)",
                          color: active() ? color : "var(--ms-text-dimmer)",
                          border: `1px solid ${active() ? color + "30" : "rgba(255,255,255,0.05)"}`,
                        }}
                        onClick={() => setMapFilter(mapFilter() === mapName ? null : mapName)}
                      >
                        <div class={styles.mapDot} style={{ background: active() ? color : "var(--ms-text-dimmer)" }} />
                        {mapName}
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Clear */}
            <Show when={hasFilters()}>
              <button class={styles.clearButton} onClick={clearFilters}>
                <Icons.X /> Clear
              </button>
            </Show>
          </div>
        </header>

        {/* ── Main Content ── */}
        <div class={styles.mainContent}>
          <div class={styles.tableArea}>
            {/* Column Headers */}
            <div class={styles.tableHeader}>
              <SortHeader label="MISSION" sortKey="name" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <SortHeader label="DATE" sortKey="date" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <SortHeader label="DURATION" sortKey="duration" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <span class={styles.colLabel}>PLAYERS</span>
              <span class={styles.colLabel}>KILLS</span>
              <span class={styles.colLabel}>TAG</span>
              <span class={styles.colLabelRight}>STATUS</span>
              <span />
            </div>

            {/* Rows */}
            <div class={styles.tableBody} data-testid="operations-list">
              <Show when={loading()}>
                <div data-testid="loading-indicator" style={{
                  display: "flex", "align-items": "center", "justify-content": "center",
                  padding: "40px", color: "var(--ms-text-dim)", "font-family": "var(--ms-font-mono)",
                  "font-size": "12px",
                }}>
                  {t("loading")}
                </div>
              </Show>
              <Show when={!loading() && filtered().length === 0}>
                <div class={styles.emptyState}>
                  <Icons.Search />
                  <span class={styles.emptyText}>{t("no_missions_found")}</span>
                  <span class={styles.emptyHint}>{t("adjust_filters")}</span>
                </div>
              </Show>
              <For each={filtered()}>
                {(op, i) => (
                  <MissionRow
                    op={op}
                    selected={selectedId() === op.id}
                    onSelect={setSelectedId}
                    onLaunch={handleLaunch}
                    index={i()}
                  />
                )}
              </For>
            </div>

            {/* Footer */}
            <div class={styles.footer}>
              <div class={styles.footerLeft}>
                <a href="https://github.com/OCAP2/web" target="_blank" rel="noopener noreferrer" class={styles.footerGithub}>
                  <Icons.GitHub />
                  <span>OCAP2</span>
                  <Icons.ExternalLink />
                </a>
                <div class={styles.dividerShort} />
                <div class={styles.footerVersions}>
                  <span class={styles.footerVersion}>
                    Server <span class={styles.footerVersionValue}>{serverVersion()}</span>
                  </span>
                </div>
                <div class={styles.dividerShort} />
                <span class={styles.footerMadeWith}>
                  Made with <span class={styles.footerHeart}><Icons.Heart /></span> for the Arma community
                </span>
              </div>
              <span class={styles.footerCenter}>
                {filtered().length} of {operations().length} missions
              </span>
              <div class={styles.footerRight}>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>Esc</kbd>
                  <span class={styles.footerAction}>{t("deselect")}</span>
                </div>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>/</kbd>
                  <span class={styles.footerAction}>{t("search_shortcut")}</span>
                </div>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>Enter</kbd>
                  <span class={styles.footerAction}>{t("open_shortcut")}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Detail Sidebar ── */}
          <Show when={selectedOp()}>
            {(op) => (
              <DetailSidebar
                op={op()}
                onLaunch={handleLaunch}
                onClose={() => setSelectedId(null)}
                t={t}
              />
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}
