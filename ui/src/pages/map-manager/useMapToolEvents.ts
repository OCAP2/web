import { createSignal, createEffect, onCleanup } from "solid-js";
import type { JobInfo, MapToolEvent } from "./types";

/** Heartbeat timeout — reconnect if no data received within this window. */
const HEARTBEAT_TIMEOUT = 45_000; // 45s (server sends keepalive every 15s)

export function useMapToolEvents(eventsUrl: () => string) {
  const [jobs, setJobs] = createSignal<JobInfo[]>([]);
  const [connected, setConnected] = createSignal(false);

  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;

  function resetHeartbeat() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      // No data received for HEARTBEAT_TIMEOUT — connection is stale
      if (es) {
        es.close();
        es = null;
      }
      setConnected(false);
      backoff = 1000;
      connect();
    }, HEARTBEAT_TIMEOUT);
  }

  function cleanup() {
    if (es) {
      es.close();
      es = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function connect() {
    cleanup();

    const url = eventsUrl();
    if (!url) return;

    es = new EventSource(url);

    es.addEventListener("snapshot", (e: MessageEvent) => {
      resetHeartbeat();
      const data = JSON.parse(e.data) as JobInfo[];
      setJobs(data);
      setConnected(true);
      backoff = 1000;
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      resetHeartbeat();
      const evt = JSON.parse(e.data) as MapToolEvent;
      if (!evt.data) return;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === evt.data!.jobId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            status: "running",
            stage: evt.data!.stage,
            stageNum: evt.data!.stageNum,
            totalStages: evt.data!.totalStages,
            message: evt.data!.message,
          };
          return next;
        }
        // Job not yet in list (race with status event) — add it
        return [
          ...prev,
          {
            id: evt.data!.jobId,
            worldName: evt.data!.jobId.replace(/-\d+$/, ""),
            inputPath: "",
            outputDir: "",
            tempDir: "",
            status: "running" as const,
            startedAt: new Date().toISOString(),
            stage: evt.data!.stage,
            stageNum: evt.data!.stageNum,
            totalStages: evt.data!.totalStages,
            message: evt.data!.message,
          },
        ];
      });
    });

    es.addEventListener("status", (e: MessageEvent) => {
      resetHeartbeat();
      const evt = JSON.parse(e.data) as MapToolEvent;
      if (!evt.job) return;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === evt.job!.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = evt.job!;
          return next;
        }
        return [...prev, evt.job!];
      });
    });

    es.onerror = () => {
      setConnected(false);
      if (es) {
        es.close();
        es = null;
      }
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoff = Math.min(backoff * 2, 30000);
        connect();
      }, backoff);
    };

    // Start heartbeat monitoring after connection opens
    resetHeartbeat();
  }

  // createEffect tracks eventsUrl() reactively — reconnects if URL changes
  // (e.g., auth token becomes available after initial mount)
  createEffect(() => {
    connect();
  });

  onCleanup(cleanup);

  return { jobs, connected };
}
