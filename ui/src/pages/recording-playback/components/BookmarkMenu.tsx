import { createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";

import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { useClickOutside } from "../../../hooks/useClickOutside";
import { BookmarkIcon, LinkIcon, TrashIcon } from "../../../components/Icons";
import { formatTime, type TimeMode } from "../../../playback/time";
import { addBookmark, bookmarks, removeBookmark } from "../bookmarks";
import { asDeepLinkTab, deepLinkUrl } from "../deepLink";
import { activePanelTab, activeSide } from "../shortcuts";
import styles from "./BookmarkMenu.module.css";

export interface BookmarkMenuProps {
  timeMode: () => TimeMode;
}

export function BookmarkMenu(props: BookmarkMenuProps): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  let panelRef: HTMLDivElement | undefined;
  useClickOutside(() => panelRef, setOpen);

  const label = (frame: number) => formatTime(frame, props.timeMode(), engine.timeConfig);

  const save = () => {
    const text = draft().trim();
    addBookmark(engine.currentFrame(), text || label(engine.currentFrame()));
    setDraft("");
  };

  /**
   * The link describes what is on screen now: frame, followed unit, open tab and
   * side filter. Clipboard writes need a user gesture and can still be refused,
   * so failure is swallowed rather than surfaced as an error the viewer cannot
   * act on.
   */
  const copyLink = () => {
    const followed = engine.followTarget();
    const url = deepLinkUrl({
      frame: engine.currentFrame(),
      unit: followed === null ? undefined : followed,
      tab: asDeepLinkTab(activePanelTab()),
      side: activeSide(),
    });
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <div ref={panelRef} class={styles.wrapper}>
      <button
        class={styles.button}
        classList={{ [styles.buttonActive]: open() || bookmarks().length > 0 }}
        title={t("bookmarks")}
        onClick={() => setOpen((v) => !v)}
      >
        <BookmarkIcon size={12} />
        <Show when={bookmarks().length > 0}>
          <span class={styles.count}>{bookmarks().length}</span>
        </Show>
      </button>

      <Show when={open()}>
        <div class={styles.panel}>
          <div class={styles.addRow}>
            <input
              class={styles.input}
              type="text"
              placeholder={t("bookmark_label_placeholder")}
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
            <button class={styles.addBtn} onClick={save}>
              {t("bookmark_add")}
            </button>
          </div>

          <button class={styles.linkRow} onClick={copyLink}>
            <LinkIcon size={14} />
            <span>{copied() ? t("link_copied") : t("copy_moment_link")}</span>
          </button>

          <Show
            when={bookmarks().length > 0}
            fallback={<div class={styles.empty}>{t("bookmarks_empty")}</div>}
          >
            <div class={styles.list}>
              <For each={bookmarks()}>
                {(bookmark) => (
                  <div class={styles.item}>
                    <button
                      class={styles.itemJump}
                      onClick={() => {
                        engine.seekTo(bookmark.frame);
                        setOpen(false);
                      }}
                    >
                      <span class={styles.itemTime}>{label(bookmark.frame)}</span>
                      <span class={styles.itemLabel}>{bookmark.label}</span>
                    </button>
                    <button
                      class={styles.itemDelete}
                      title={t("bookmark_remove")}
                      onClick={() => removeBookmark(bookmark.id)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
