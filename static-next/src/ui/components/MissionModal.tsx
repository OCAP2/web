import { createSignal, Show, For, onMount } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import type { Operation } from "../../data/types";
import { ApiClient, type OperationFilters } from "../../data/api-client";
import { useI18n } from "../hooks/useLocale";
import styles from "./MissionModal.module.css";

export interface MissionModalProps {
  open: Accessor<boolean>;
  onClose: () => void;
  onSelectOperation: (op: Operation) => void;
}

/**
 * Full-screen modal for browsing and selecting missions.
 *
 * - Fetches operations via ApiClient.getOperations().
 * - Provides a name filter text input with submit button.
 * - Displays a scrollable list of operations.
 * - Clicking an operation calls onSelectOperation and closes the modal.
 */
export function MissionModal(props: MissionModalProps): JSX.Element {
  const { t } = useI18n();
  const [operations, setOperations] = createSignal<Operation[]>([]);
  const [nameFilter, setNameFilter] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const api = new ApiClient();

  const fetchOperations = async (filters?: OperationFilters) => {
    setLoading(true);
    try {
      const ops = await api.getOperations(filters);
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
    const name = nameFilter().trim();
    void fetchOperations(name ? { name } : undefined);
  };

  const handleSelect = (op: Operation) => {
    props.onSelectOperation(op);
    props.onClose();
  };

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  return (
    <Show when={props.open()}>
      <div data-testid="mission-modal" class={styles.modalOverlay}>
        <div class={styles.modalBase}>
          <div class={styles.modalHeader}>
            <span>{t("select_mission")}</span>
          </div>
          <div class={styles.modalFilter}>
            <form
              data-testid="filter-form"
              onSubmit={handleSubmit}
              style={{ display: "flex", gap: "4px", width: "100%" }}
            >
              <input
                type="text"
                data-testid="filter-name-input"
                class="filter-input"
                placeholder={`${t("filter")}...`}
                value={nameFilter()}
                onInput={(e) => setNameFilter(e.currentTarget.value)}
                style={{ flex: "1", background: "rgba(255,255,255,0.1)", color: "#f2f2f2", border: "1px solid #555", padding: "4px 8px" }}
              />
              <button type="submit" data-testid="filter-submit-button" class={styles.modalButton}>
                {t("filter")}
              </button>
            </form>
          </div>
          <Show when={loading()}>
            <div data-testid="loading-indicator" style={{ padding: "20px", "text-align": "center", color: "#f2f2f2" }}>{t("loading")}</div>
          </Show>
          <div class={styles.modalBody} data-testid="operations-list">
            <table>
              <thead>
                <tr>
                  <th>{t("mission")}</th>
                  <th>{t("map")}</th>
                  <th>{t("durability")}</th>
                  <th>{t("data")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={operations()}>
                  {(op) => (
                    <tr
                      data-testid={`operation-${op.id}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleSelect(op)}
                    >
                      <td>{op.missionName}</td>
                      <td>{op.worldName}</td>
                      <td>{formatDuration(op.missionDuration)}</td>
                      <td>{op.date}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Show>
  );
}
