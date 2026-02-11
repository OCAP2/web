import { createSignal, Show, For, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { Operation } from "../data/types";
import { ApiClient, type OperationFilters } from "../data/api-client";
import { useI18n } from "../ui/hooks/useLocale";
import { CustomizeLogo } from "../ui/components/CustomizeLogo";
import { AboutModal } from "../ui/components/AboutModal";
import styles from "./MissionSelector.module.css";

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) {
    const s = seconds % 60;
    return `${mins}m ${s}s`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  const s = seconds % 60;
  return `${hours}h ${remainingMins}m ${s}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}

function getStatusInfo(op: Operation): { icon: string; tooltip: string } {
  const format = op.storageFormat || "json";
  const conversionStatus = op.conversionStatus || "completed";
  if (conversionStatus === "pending") return { icon: "\u23F3", tooltip: "Converting (JSON \u2192 Protobuf)" };
  if (conversionStatus === "converting") return { icon: "\u2699\uFE0F", tooltip: "Converting (JSON \u2192 Protobuf)" };
  if (conversionStatus === "failed") return { icon: "\u274C", tooltip: "Failed (JSON \u2192 Protobuf)" };
  if (format === "protobuf") return { icon: "\uD83D\uDCE1", tooltip: "Streaming (Protobuf)" };
  return { icon: "\uD83D\uDCC4", tooltip: "Static (JSON)" };
}

/**
 * Full-page mission selector — the entry page at `/`.
 */
export function MissionSelector(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [operations, setOperations] = createSignal<Operation[]>([]);
  const [nameFilter, setNameFilter] = createSignal("");
  const [tagFilter, setTagFilter] = createSignal("");
  const [newerFilter, setNewerFilter] = createSignal("2017-06-01");
  const [olderFilter, setOlderFilter] = createSignal("2099-12-12");
  const [loading, setLoading] = createSignal(false);
  const [allTags, setAllTags] = createSignal<string[]>([]);
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const api = new ApiClient();

  const fetchOperations = async (filters?: OperationFilters) => {
    setLoading(true);
    try {
      const ops = await api.getOperations(filters);
      if (allTags().length === 0) {
        const tags = [...new Set(ops.map((op) => op.tag).filter(Boolean))] as string[];
        setAllTags(tags);
      }
      setOperations(ops.reverse());
    } catch {
      setOperations([]);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void fetchOperations();
  });

  const handleSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (e) => {
    e.preventDefault();
    const filters: OperationFilters = {};
    const name = nameFilter().trim();
    const tag = tagFilter();
    const newer = newerFilter();
    const older = olderFilter();
    if (name) filters.name = name;
    if (tag) filters.tag = tag;
    if (newer) filters.newer = newer;
    if (older) filters.older = older;
    void fetchOperations(Object.keys(filters).length > 0 ? filters : undefined);
  };

  const handleSelect = (op: Operation) => {
    const id = op.filename ?? op.id;
    navigate(`/recording/${encodeURIComponent(id)}`);
  };

  return (
    <>
      <div data-testid="mission-selector" class={styles.page}>
        <div class={styles.container}>
          <div class={styles.header}>
            <span>{t("select_mission")}</span>
            <div class={styles.headerSpacer} />
            <div
              data-testid="info-button"
              class={styles.infoButton}
              title="Information"
              onClick={() => setAboutOpen(true)}
            >
              i
            </div>
          </div>
          <div class={styles.filterBar}>
            <form
              data-testid="filter-form"
              onSubmit={handleSubmit}
              style={{ display: "flex", gap: "4px", width: "100%", "align-items": "center" }}
            >
              <span class={`${styles.a3Select} ${styles.tagSelect}`}>
                <select
                  data-testid="filter-tag-input"
                  value={tagFilter()}
                  onChange={(e) => setTagFilter(e.currentTarget.value)}
                >
                  <option value="">All</option>
                  <For each={allTags()}>
                    {(tag) => <option value={tag}>{tag}</option>}
                  </For>
                </select>
              </span>
              <input
                type="text"
                data-testid="filter-name-input"
                class={styles.filterInput}
                placeholder={t("name_missions")}
                value={nameFilter()}
                onInput={(e) => setNameFilter(e.currentTarget.value)}
              />
              <input
                type="date"
                data-testid="filter-newer-input"
                value={newerFilter()}
                onInput={(e) => setNewerFilter(e.currentTarget.value)}
                class={styles.dateInput}
              />
              <input
                type="date"
                data-testid="filter-older-input"
                value={olderFilter()}
                onInput={(e) => setOlderFilter(e.currentTarget.value)}
                class={styles.dateInput}
              />
              <button type="submit" data-testid="filter-submit-button" class={styles.filterButton} disabled={loading()}>
                {t("filter")}
              </button>
            </form>
          </div>
          <div class={styles.body} data-testid="operations-list">
            <Show when={loading()}>
              <div data-testid="loading-indicator" class={styles.loadingOverlay}>
                {t("loading")}
              </div>
            </Show>
            <table>
              <thead>
                <tr>
                  <th>{t("mission")}</th>
                  <th>{t("map")}</th>
                  <th>{t("data")}</th>
                  <th>{t("durability")}</th>
                  <th>{t("tag")}</th>
                  <th>{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={operations()}>
                  {(op) => {
                    const status = getStatusInfo(op);
                    return (
                      <tr
                        data-testid={`operation-${op.id}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => handleSelect(op)}
                      >
                        <td>{op.missionName}</td>
                        <td>
                          <span class={styles.mapPreviewWrap}>
                            <img
                              src={`images/maps/${op.worldName.toLowerCase()}/preview_256.png`}
                              alt=""
                              class={styles.mapPreview}
                              onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                            />
                            <img
                              src={`images/maps/${op.worldName.toLowerCase()}/preview_512.png`}
                              alt=""
                              class={styles.previewPopup}
                            />
                          </span>
                          {op.worldName}
                        </td>
                        <td>{formatDate(op.date)}</td>
                        <td>{formatDuration(op.missionDuration)}</td>
                        <td>{op.tag ?? ""}</td>
                        <td title={status.tooltip} style={{ "font-size": "1.2em" }}>{status.icon}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </div>
        <CustomizeLogo />
      </div>
      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
      />
    </>
  );
}
