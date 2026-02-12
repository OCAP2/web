import { createSignal, createMemo, Show, For, onMount, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type { Operation } from "../../data/types";
import { ApiClient, type BuildInfo } from "../../data/api-client";
import { useI18n } from "../../ui/hooks/useLocale";
import { useCustomize } from "../../ui/hooks/useCustomize";
import { LOCALES } from "../../ui/i18n/i18n";
import { LOCALE_LABELS } from "./constants";
import { Icons } from "./icons";
import { getMapColor, isOpReady } from "./helpers";
import { StatPill, TagBadge, SortHeader } from "./components";
import { MissionRow } from "./MissionRow";
import { DetailSidebar } from "./DetailSidebar";
import styles from "./MissionSelector.module.css";

// ─── Main Component ───

export function MissionSelector(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const api = new ApiClient();
  const customize = useCustomize();

  // State
  const [operations, setOperations] = createSignal<Operation[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [tagFilter, setTagFilter] = createSignal<string | null>(null);
  const [mapFilter, setMapFilter] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [sortBy, setSortBy] = createSignal("date");
  const [sortDir, setSortDir] = createSignal("desc");
  const [langOpen, setLangOpen] = createSignal(false);
  const [buildInfo, setBuildInfo] = createSignal<BuildInfo | null>(null);

  let searchRef: HTMLInputElement | undefined;
  let scrollRef: HTMLDivElement | undefined;

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
  const uniqueMaps = createMemo(() => [...new Set(operations().map((o) => o.worldName))]);
  const uniqueTags = createMemo(() => [...new Set(operations().map((o) => o.tag).filter(Boolean))] as string[]);

  const hasPlayerData = createMemo(() => operations().some(op => (op.playerCount ?? 0) > 0));
  const hasKillData = createMemo(() => operations().some(op => (op.killCount ?? 0) > 0));
  const maxPlayers = createMemo(() => Math.max(0, ...operations().map(op => op.playerCount ?? 0)));
  const totalKills = createMemo(() => operations().reduce((s, op) => s + (op.killCount ?? 0), 0));

  const gridColumns = createMemo(() => {
    let cols = "1fr 130px 100px";
    if (hasPlayerData()) cols += " 70px";
    if (hasKillData()) cols += " 70px";
    cols += " 70px 100px 40px";
    return cols;
  });

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

  const virtualizer = createVirtualizer({
    get count() { return filtered().length; },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => 61,
    overscan: 10,
    initialRect: { width: 0, height: 800 },
  });

  const selectedOp = createMemo(() => {
    const id = selectedId();
    return id ? operations().find((o) => o.id === id) ?? null : null;
  });

  const hasFilters = () => search() || tagFilter() || mapFilter();

  const clearFilters = () => {
    setSearch("");
    setTagFilter(null);
    setMapFilter(null);
  };

  // Launch handler
  const handleLaunch = (op: Operation) => {
    const id = op.filename ?? op.id;
    navigate(`/loading/${encodeURIComponent(id)}`, {
      state: {
        missionName: op.missionName,
        worldName: op.worldName,
        missionDuration: op.missionDuration,
      },
    });
  };
  return (
      <div data-testid="mission-selector" class={styles.page}>
        {/* ── Header ── */}
        <header class={styles.header}>
          <div class={styles.headerRow}>
            <div class={styles.logoArea}>
              <img src={`${import.meta.env.BASE_URL}ocap-logo.png`} height="60" alt="OCAP" />
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
                  {customize().headerSubtitle || <>Operation Capture and Playback &middot; {operations().length} {t("recordings")}</>}
                </div>
              </div>
            </div>

            {/* Right side: stats + language */}
            <div class={styles.statsArea}>
              <div class={styles.statPills}>
                <StatPill icon={<Icons.Globe />} value={uniqueMaps().length} label={t("maps_label")} />
                <Show when={hasPlayerData()}>
                  <StatPill icon={<Icons.Users />} value={maxPlayers()} label={t("max_players")} />
                </Show>
                <Show when={hasKillData()}>
                  <StatPill icon={<Icons.Crosshair />} value={totalKills()} label={t("total_kills")} />
                </Show>
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
                <Icons.X /> {t("clear")}
              </button>
            </Show>
          </div>
        </header>

        {/* ── Main Content ── */}
        <div class={styles.mainContent}>
          <div class={styles.tableArea}>
            {/* Column Headers */}
            <div class={styles.tableHeader} style={{ "grid-template-columns": gridColumns() }}>
              <SortHeader label={t("mission")} sortKey="name" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
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
            <div ref={scrollRef} class={styles.tableBody} data-testid="operations-list">
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
              <div class={styles.virtualContainer} style={{ height: `${virtualizer.getTotalSize()}px` }}>
                <For each={virtualizer.getVirtualItems()}>
                  {(vItem) => {
                    const op = () => filtered()[vItem.index];
                    return (
                      <Show when={op()}>
                        {(o) => (
                          <div class={styles.virtualRow} style={{ height: `${vItem.size}px`, transform: `translateY(${vItem.start}px)` }}>
                            <MissionRow
                              op={o()}
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
                  <Icons.GitHub />
                  <span>OCAP2</span>
                  <Icons.ExternalLink />
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
                  <span class={styles.footerHeart}><Icons.Heart /></span> {t("made_with_love")}
                </span>
              </div>
              <span class={styles.footerCenter}>
                {filtered().length} {t("of")} {operations().length} {t("missions")}
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
          <Show when={selectedOp()}>
            {(op) => (
              <DetailSidebar
                op={op()}
                onLaunch={handleLaunch}
                onClose={() => setSelectedId(null)}
              />
            )}
          </Show>
        </div>
      </div>
  );
}
