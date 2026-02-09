import { createSignal, Show, For, onMount } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import type { Operation } from "../../data/types";
import { ApiClient, type OperationFilters } from "../../data/api-client";

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
  const [operations, setOperations] = createSignal<Operation[]>([]);
  const [nameFilter, setNameFilter] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const api = new ApiClient();

  const fetchOperations = async (filters?: OperationFilters) => {
    setLoading(true);
    try {
      const ops = await api.getOperations(filters);
      setOperations(ops);
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
      <div data-testid="mission-modal" class="mission-modal-overlay">
        <div class="mission-modal">
          <div class="mission-modal-header">
            <h2>Select Mission</h2>
            <button
              data-testid="modal-close-button"
              class="modal-close-button"
              onClick={() => props.onClose()}
            >
              Close
            </button>
          </div>
          <form
            data-testid="filter-form"
            class="mission-filter-form"
            onSubmit={handleSubmit}
          >
            <input
              type="text"
              data-testid="filter-name-input"
              class="filter-name-input"
              placeholder="Filter by name..."
              value={nameFilter()}
              onInput={(e) => setNameFilter(e.currentTarget.value)}
            />
            <button type="submit" data-testid="filter-submit-button">
              Search
            </button>
          </form>
          <Show when={loading()}>
            <div data-testid="loading-indicator">Loading...</div>
          </Show>
          <div data-testid="operations-list" class="operations-list">
            <For each={operations()}>
              {(op) => (
                <div
                  data-testid={`operation-${op.id}`}
                  class="operation-item"
                  onClick={() => handleSelect(op)}
                >
                  <span class="op-name">{op.missionName}</span>
                  <span class="op-world">{op.worldName}</span>
                  <span class="op-duration">{formatDuration(op.missionDuration)}</span>
                  <span class="op-date">{op.date}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
