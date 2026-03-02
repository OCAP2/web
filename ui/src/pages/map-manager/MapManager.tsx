import type { JSX } from "solid-js";
import { createSignal, createMemo, createEffect, on, onMount, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiClient } from "../../data/apiClient";
import { useAuth } from "../../hooks/useAuth";
import type { ToolSet, HealthCheck, MapInfo } from "./types";
import { useMapToolEvents } from "./useMapToolEvents";
import { StatusStrip } from "./components";
import { MapCard } from "./MapCard";
import { MapRow } from "./MapRow";
import { MapDetail } from "./MapDetail";
import { ImportDialog, DeleteConfirm } from "./dialogs";
import { totalDiskMB } from "./helpers";
import {
  ArrowLeftIcon,
  SearchIcon,
  PaletteIcon,
  GridIcon,
  ListIcon,
  GlobeIcon,
  FilePlusIcon,
} from "../../components/Icons";
import { basePath } from "../../data/basePath";
import styles from "./MapManager.module.css";

const api = new ApiClient();
const imageBase = basePath.replace(/\/+$/, "");

export function MapManager(): JSX.Element {
  const navigate = useNavigate();
  const { authenticated } = useAuth();

  // ─── State ───
  const [tools, setTools] = createSignal<ToolSet>([]);
  const [health, setHealth] = createSignal<HealthCheck[]>([]);
  const [maps, setMaps] = createSignal<MapInfo[]>([]);
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal<string | null>(null);
  const [sortBy, setSortBy] = createSignal("name");
  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [showImport, setShowImport] = createSignal(false);
  const [showDelete, setShowDelete] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [loading, setLoading] = createSignal(true);

  // SSE events
  const { jobs } = useMapToolEvents(() => api.getMapToolEventsUrl());

  // Refresh maps when any job finishes (done/failed) — the map list on
  // disk has changed but the `maps` signal still holds the stale snapshot.
  const doneCount = createMemo(() =>
    jobs().filter((j) => j.status === "done" || j.status === "failed").length,
  );
  createEffect(
    on(doneCount, (cur, prev) => {
      if (prev !== undefined && cur > prev) {
        api.getMapToolMaps().then(setMaps).catch(() => {});
      }
    }),
  );

  // ─── Derived ───
  const filteredMaps = createMemo(() => {
    let result = maps();
    const q = search().toLowerCase();
    if (q) {
      result = result.filter((m) => m.name.toLowerCase().includes(q));
    }
    const sf = statusFilter();
    if (sf) {
      result = result.filter((m) => m.status === sf);
    }
    const sort = sortBy();
    result = [...result].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return (b.worldSize ?? 0) - (a.worldSize ?? 0);
      if (sort === "disk") return totalDiskMB(b.files) - totalDiskMB(a.files);
      return 0;
    });
    return result;
  });

  const selectedMap = createMemo(() =>
    maps().find((m) => m.name === selected()) ?? null,
  );

  // ─── Load data ───
  onMount(async () => {
    try {
      const [t, m, h] = await Promise.all([
        api.getMapToolTools(),
        api.getMapToolMaps(),
        api.getMapToolHealth(),
      ]);
      setTools(t);
      setMaps(m);
      setHealth(h);
    } catch (err) {
      console.error("Map manager failed to load:", err);
      navigate("/", { replace: true });
      return;
    }
    setLoading(false);
  });

  // ─── Actions ───
  async function handleImport(file: File) {
    setUploading(true);
    setUploadProgress(0);
    try {
      await api.importMapToolZip(file, (loaded, total) => {
        setUploadProgress((loaded / total) * 100);
      });
      setShowImport(false);
      // Maps list will refresh automatically when the job completes via SSE
    } catch (e) {
      console.error("Import failed:", e);
    }
    setUploading(false);
  }

  async function handleDelete() {
    const name = selected();
    if (!name) return;
    try {
      await api.deleteMapToolMap(name);
      setSelected(null);
      setShowDelete(false);
      const m = await api.getMapToolMaps();
      setMaps(m);
    } catch (e) {
      console.error("Delete failed:", e);
    }
  }

  async function handleRestyle() {
    try {
      await api.restyleMapToolAll();
    } catch (e) {
      console.error("Restyle failed:", e);
    }
  }

  async function handleCancelJob(id: string) {
    try {
      await api.cancelMapToolJob(id);
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  }

  return (
    <div class={styles.page}>
      {/* Header */}
      <header class={styles.header}>
        <div class={styles.headerTop}>
          <div class={styles.headerLeft}>
            <button class={styles.backBtn} title="Back to recordings" onClick={() => navigate("/")}>
              <ArrowLeftIcon size={16} />
            </button>
            <div>
              <div class={styles.headerTitleRow}>
                <span class={styles.headerTitle}>OCAP</span>
                <span class={styles.headerSubtitle}>Map Tool</span>
              </div>
            </div>
          </div>
          <div class={styles.headerRight}>
            <Show when={authenticated()}>
              <button
                class={styles.importBtn}
                onClick={() => setShowImport(true)}
              >
                <FilePlusIcon size={12} /> Import Map
              </button>
              <button class={styles.restyleBtn} onClick={handleRestyle}>
                <PaletteIcon size={12} /> Restyle All
              </button>
            </Show>
          </div>
        </div>

        <Show when={!loading()}>
          {/* Status strip — tools | active job | jobs */}
          <StatusStrip tools={tools()} health={health()} jobs={jobs()} onCancel={handleCancelJob} />

          {/* Filter bar */}
          <div class={styles.filterBar}>
            <div class={styles.searchBox}>
              <span class={styles.searchIcon}>
                <SearchIcon size={14} />
              </span>
              <input
                type="text"
                placeholder="Search maps..."
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class={styles.searchInput}
              />
            </div>

            {/* Status filter */}
            <div class={styles.filterGroup}>
              <For each={[{ val: null, label: "All" }, { val: "complete", label: "Complete" }, { val: "incomplete", label: "Partial" }]}>
                {(f) => (
                  <button
                    class={styles.filterBtn}
                    classList={{ [styles.filterBtnActive]: statusFilter() === f.val }}
                    onClick={() => setStatusFilter(statusFilter() === f.val ? null : f.val)}
                  >
                    {f.label}
                  </button>
                )}
              </For>
            </div>

            {/* Sort */}
            <div class={styles.sortGroup}>
              <span class={styles.sortLabel}>Sort</span>
              <For each={[{ id: "name", label: "Name" }, { id: "size", label: "Size" }, { id: "disk", label: "Disk" }]}>
                {(s) => (
                  <button
                    class={styles.sortBtn}
                    classList={{ [styles.sortBtnActive]: sortBy() === s.id }}
                    onClick={() => setSortBy(s.id)}
                  >
                    {s.label}
                  </button>
                )}
              </For>
            </div>

            {/* View toggle */}
            <div class={styles.viewToggle}>
              <button
                class={styles.viewBtn}
                classList={{ [styles.viewBtnActive]: viewMode() === "grid" }}
                onClick={() => setViewMode("grid")}
              >
                <GridIcon size={14} />
              </button>
              <button
                class={styles.viewBtn}
                classList={{ [styles.viewBtnActive]: viewMode() === "list" }}
                onClick={() => setViewMode("list")}
              >
                <ListIcon size={14} />
              </button>
            </div>

            <span class={styles.mapCount}>{filteredMaps().length}</span>
          </div>
        </Show>
      </header>

      <Show when={!loading()}>
        {/* Main content */}
        <div class={styles.main}>
          <div
            class={styles.content}
            classList={{ [styles.contentList]: viewMode() === "list" }}
          >
            <Show
              when={viewMode() === "grid"}
              fallback={
                <div class={styles.listContainer}>
                  <div class={styles.listHeader}>
                    <span />
                    <For each={["SIZE", "LAYERS", "DISK", "STATUS"]}>
                      {(h) => (
                        <span
                          class={styles.listHeaderLabel}
                          classList={{ [styles.listHeaderRight]: h === "STATUS" }}
                        >
                          {h}
                        </span>
                      )}
                    </For>
                  </div>
                  <For each={filteredMaps()}>
                    {(m) => (
                      <MapRow
                        map={m}
                        selected={selected() === m.name}
                        onSelect={() =>
                          setSelected(selected() === m.name ? null : m.name)
                        }
                      />
                    )}
                  </For>
                </div>
              }
            >
              <div class={styles.grid}>
                <For each={filteredMaps()}>
                  {(m) => (
                    <MapCard
                      map={m}
                      selected={selected() === m.name}
                      baseUrl={imageBase}
                      onSelect={() =>
                        setSelected(selected() === m.name ? null : m.name)
                      }
                    />
                  )}
                </For>
              </div>
            </Show>

            <Show when={filteredMaps().length === 0}>
              <div class={styles.empty}>
                <GlobeIcon size={14} />
                <span class={styles.emptyText}>
                  {search()
                    ? "No maps match your search"
                    : "No maps imported yet"}
                </span>
                <Show when={!search()}>
                  <button
                    class={styles.emptyImportBtn}
                    onClick={() => setShowImport(true)}
                  >
                    <FilePlusIcon size={12} /> Import Map
                  </button>
                </Show>
              </div>
            </Show>
          </div>

          {/* Detail sidebar */}
          <Show when={selectedMap()}>
            {(m) => (
              <MapDetail
                map={m()}
                baseUrl={imageBase}
                onClose={() => setSelected(null)}
                onDelete={() => setShowDelete(true)}
              />
            )}
          </Show>
        </div>
      </Show>

      {/* Modals */}
      <Show when={showImport()}>
        <ImportDialog
          onImport={handleImport}
          onClose={() => setShowImport(false)}
          uploading={uploading()}
          uploadProgress={uploadProgress()}
        />
      </Show>

      <Show when={showDelete() && selectedMap()}>
        <DeleteConfirm
          map={selectedMap()!}
          onConfirm={handleDelete}
          onClose={() => setShowDelete(false)}
        />
      </Show>
    </div>
  );
}
