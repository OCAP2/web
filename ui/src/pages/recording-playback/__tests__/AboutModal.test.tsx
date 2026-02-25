import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { AboutModal } from "../components/AboutModal";
import { I18nProvider } from "../../../hooks/useLocale";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAboutModal(
  overrides: {
    open?: boolean;
    extensionVersion?: string;
    addonVersion?: string;
  } = {},
) {
  const [open, setOpen] = createSignal(overrides.open ?? true);
  const onClose = vi.fn();

  const extensionVersion = overrides.extensionVersion
    ? () => overrides.extensionVersion
    : undefined;
  const addonVersion = overrides.addonVersion
    ? () => overrides.addonVersion
    : undefined;

  const result = render(() => (
    <I18nProvider locale="en">
      <AboutModal
        open={open}
        onClose={onClose}
        extensionVersion={extensionVersion}
        addonVersion={addonVersion}
      />
    </I18nProvider>
  ));

  return { onClose, open, setOpen, ...result };
}

describe("AboutModal", () => {
  it("hidden when open is false", () => {
    renderAboutModal({ open: false });

    expect(screen.queryByTestId("about-modal")).toBeNull();
  });

  it("shows modal when open is true", () => {
    renderAboutModal({ open: true });

    expect(screen.getByTestId("about-modal")).toBeTruthy();
  });

  it("shows app name 'Operation Capture And Playback'", () => {
    renderAboutModal();

    expect(screen.getByText("Operation Capture And Playback")).toBeTruthy();
  });

  it("close button calls onClose", () => {
    const { onClose } = renderAboutModal();

    // The close button is in the header — find it by querying buttons within the modal
    const modal = screen.getByTestId("about-modal");
    const header = modal.querySelector("[class*='header']")!;
    const closeBtn = header.querySelector("button")!;
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows keyboard shortcuts (Space, E)", () => {
    renderAboutModal();

    // The modal renders <kbd>Space</kbd> and <kbd>E</kbd>
    const kbds = screen.getByTestId("about-modal").querySelectorAll("kbd");
    const kbdTexts = Array.from(kbds).map((el) => el.textContent);

    expect(kbdTexts).toContain("Space");
    expect(kbdTexts).toContain("E");
  });

  it("shows extension version when provided", () => {
    renderAboutModal({ extensionVersion: "1.2.3" });

    expect(screen.getByText("1.2.3")).toBeTruthy();
  });

  it("shows language selector", () => {
    renderAboutModal();

    expect(screen.getByTestId("language-select")).toBeTruthy();
  });

  it("server version shows 'unknown' when API fails", () => {
    renderAboutModal();

    // Since no server is running, the API call fails and serverVersion falls back to "unknown"
    expect(screen.getByText("unknown")).toBeTruthy();
  });

  it("shows BuildVersion from API when available", async () => {
    const { ApiClient } = await import("../../../data/apiClient");
    vi.spyOn(ApiClient.prototype, "getVersion").mockResolvedValue({
      BuildVersion: "2.5.0",
      BuildCommit: "abc1234",
      BuildDate: "2025-01-01",
    });

    renderAboutModal();

    await vi.waitFor(() => {
      expect(screen.getByText("2.5.0")).toBeTruthy();
    });
  });

  it("falls back to BuildCommit when BuildVersion is empty", async () => {
    const { ApiClient } = await import("../../../data/apiClient");
    vi.spyOn(ApiClient.prototype, "getVersion").mockResolvedValue({
      BuildVersion: "",
      BuildCommit: "abc1234",
      BuildDate: "2025-01-01",
    });

    renderAboutModal();

    await vi.waitFor(() => {
      expect(screen.getByText("abc1234")).toBeTruthy();
    });
  });

  it("shows addon version when provided", () => {
    renderAboutModal({ addonVersion: "3.0.1" });

    expect(screen.getByText("3.0.1")).toBeTruthy();
  });

  it("hides addon version row when not provided", () => {
    renderAboutModal();

    // The addon version label should NOT appear
    expect(screen.queryByText(/Addon version/)).toBeNull();
  });
});
