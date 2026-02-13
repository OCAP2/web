import { onMount } from "solid-js";
import type { JSX } from "solid-js";
import { useParams, useNavigate, useLocation } from "@solidjs/router";
import { useI18n } from "../ui/hooks/useLocale";
import { OcapLogoSvg } from "./mission-selector/OcapLogoSvg";
import { formatDuration } from "./mission-selector/helpers";
import styles from "./LoadingTransition.module.css";

interface LocationState {
  missionName: string;
  worldName: string;
  missionDuration: number;
}

export function LoadingTransition(): JSX.Element {
  const params = useParams<{ id: string; name: string }>();
  const navigate = useNavigate();
  const location = useLocation<LocationState>();
  const { t } = useI18n();

  const state = () => location.state as LocationState | undefined;

  onMount(() => {
    setTimeout(() => {
      navigate(`/recording/${params.id}/${params.name}`, { replace: true });
    }, 2000);
  });

  return (
    <div class={styles.loadingScreen} data-testid="loading-screen">
      <div class={styles.loadingContent}>
        <div class={styles.loadingLogo}>
          <OcapLogoSvg size={56} />
        </div>
        <div class={styles.loadingTitle}>
          {t("loading_mission")} {state()?.missionName ?? ""}
        </div>
        <div class={styles.loadingSubtitle}>
          {state()?.worldName ?? ""} &middot; {formatDuration(state()?.missionDuration ?? 0)}
        </div>
        <div class={styles.loadingBarTrack}>
          <div class={styles.loadingBarFill} />
        </div>
        <div class={styles.loadingHint}>{t("initializing_engine")}</div>
      </div>
    </div>
  );
}
