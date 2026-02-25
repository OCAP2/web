import type { JSX } from "solid-js";
import { createSignal, createMemo, onMount, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiClient } from "../../data/apiClient";
import { useAuth } from "../../hooks/useAuth";
import type { ToolSet, MapInfo, JobInfo } from "./types";
import { useMapToolEvents } from "./useMapToolEvents";
import { ToolStatus, JobHistory } from "./components";
import { MapCard } from "./MapCard";
import { MapRow } from "./MapRow";
import { MapDetail } from "./MapDetail";
import { ImportDialog, DeleteConfirm } from "./dialogs";
import {
  SearchIcon,
  UploadIcon,
  PaletteIcon,
  GridIcon,
  ListIcon,
  ArrowLeftIcon,
} from "../../components/Icons";
import styles from "./MapManager.module.css";

const api = new ApiClient();

export function MapManager(): JSX.Element {
  const navigate = useNavigate();
  const { authenticated } = useAuth();

  // ─── State ───
  const [tools, setTools] = createSignal<ToolSet>([]);
  const [maps, setMaps] = createSignal<MapInfo[]>([]);
  const [search, setSearch] = createSignal("");
  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [showImport, setShowImport] = createSignal(false);
  const [showDelete, setShowDelete] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [loading, setLoading] = createSignal(true);

  // SSE events
  const { jobs } = useMapToolEvents(() => api.getMapToolEventsUrl());

  // ─── Derived ───
  const filteredMaps = createMemo(() => {
    const q = search().toLowerCase();
    if (!q) return maps();
    return maps().filter((m) => m.name.toLowerCase().includes(q));
  });

  const selectedMap = createMemo(() =>
    maps().find((m) => m.name === selected()) ?? null,
  );

  const activeJobs = createMemo(() =>
    jobs().filter((j) => j.status === "running" || j.status === "pending"),
  );

  // ─── Load data ───
  onMount(async () => {
    try {
      const [t, m] = await Promise.all([
        api.getMapToolTools(),
        api.getMapToolMaps(),
      ]);
      setTools(t);
      setMaps(m);
    } catch {
      // If maptool is not available, navigate back
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
      // Refresh maps list
      const m = await api.getMapToolMaps();
      setMaps(m);
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
        <div class={styles.headerLeft}>
          <button class={styles.backBtn} onClick={() => navigate("/")}>
            <ArrowLeftIcon size={18} />
          </button>
          <h1 class={styles.title}>Map Manager</h1>
        </div>
        <div class={styles.headerRight}>
          <Show when={authenticated()}>
            <button class={styles.actionBtn} onClick={() => setShowImport(true)}>
              <UploadIcon size={16} /> Import
            </button>
            <button class={styles.actionBtn} onClick={handleRestyle}>
              <PaletteIcon size={16} /> Restyle All
            </button>
          </Show>
        </div>
      </header>

      <Show when={!loading()}>
        {/* Tool status bar */}
        <div class={styles.toolBar}>
          <ToolStatus tools={tools()} />
        </div>

        {/* Active jobs */}
        <Show when={activeJobs().length > 0}>
          <div class={styles.jobsBar}>
            <JobHistory jobs={activeJobs()} onCancel={handleCancelJob} />
          </div>
        </Show>

        {/* Filter bar */}
        <div class={styles.filterBar}>
          <div class={styles.searchBox}>
            <SearchIcon size={16} />
            <input
              type="text"
              placeholder="Search maps..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class={styles.searchInput}
            />
          </div>
          <div class={styles.viewToggle}>
            <button
              class={styles.viewBtn}
              classList={{ [styles.viewBtnActive]: viewMode() === "grid" }}
              onClick={() => setViewMode("grid")}
            >
              <GridIcon size={16} />
            </button>
            <button
              class={styles.viewBtn}
              classList={{ [styles.viewBtnActive]: viewMode() === "list" }}
              onClick={() => setViewMode("list")}
            >
              <ListIcon size={16} />
            </button>
          </div>
          <span class={styles.mapCount}>
            {filteredMaps().length} map{filteredMaps().length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Main content */}
        <div class={styles.main}>
          <div class={styles.content}>
            <Show
              when={viewMode() === "grid"}
              fallback={
                <div class={styles.listContainer}>
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
                      baseUrl=""
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
                <p>No maps found</p>
              </div>
            </Show>
          </div>

          {/* Detail sidebar */}
          <Show when={selectedMap()}>
            {(m) => (
              <MapDetail
                map={m()}
                baseUrl=""
                onClose={() => setSelected(null)}
                onDelete={() => setShowDelete(true)}
              />
            )}
          </Show>
        </div>

        {/* Completed/failed jobs history */}
        <Show when={jobs().some((j) => j.status === "done" || j.status === "failed")}>
          <div class={styles.historySection}>
            <h3 class={styles.historyTitle}>Job History</h3>
            <JobHistory
              jobs={jobs().filter(
                (j) => j.status === "done" || j.status === "failed" || j.status === "cancelled",
              )}
              onCancel={handleCancelJob}
            />
          </div>
        </Show>
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
