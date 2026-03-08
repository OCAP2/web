import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { I18nProvider } from "../../../hooks/useLocale";
import { ImportDialog, DeleteConfirm } from "../dialogs";
import type { MapInfo } from "../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── ImportDialog ───

describe("ImportDialog", () => {
  it("renders dialog title", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("Import Map");
  });

  it("renders drop zone with instructions", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain(".zip");
    expect(container.textContent).toContain("browse");
    expect(container.textContent).toContain("Max 2 GB");
  });

  it("renders structure hint", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("meta.json");
    expect(container.textContent).toContain("sat/");
  });

  it("import button is disabled when no file selected", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const buttons = container.querySelectorAll("button");
    const importBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Import"),
    );
    expect(importBtn).toBeDefined();
    expect(importBtn!.disabled).toBe(true);
  });

  it("shows 'Select a .zip file' status when no file", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("Select a .zip file");
  });

  it("calls onClose when cancel clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={onClose} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    );
    expect(cancelBtn).toBeDefined();
    fireEvent.click(cancelBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={onClose} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    // Overlay is the outermost div
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows upload progress when uploading", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={true} uploadProgress={45} uploadError={null} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("Uploading...");
    expect(container.textContent).toContain("45%");
  });

  it("caps progress display at 100%", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={true} uploadProgress={120} uploadError={null} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("100%");
  });

  it("shows grad_meh link", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const link = container.querySelector('a[href*="grad_meh"]');
    expect(link).not.toBeNull();
  });

  it("accepts a .zip file via file input and shows file info", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "test-map.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    expect(container.textContent).toContain("test-map.zip");
  });

  it("rejects non-.zip files via file input", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "test.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    expect(container.textContent).toContain("Select a .zip file");
  });

  it("shows file size in MB after selection", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const data = new Uint8Array(10 * 1024 * 1024); // 10 MB
    const file = new File([data], "big.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    expect(container.textContent).toContain("10.0 MB");
  });

  it("enables import button when file is selected", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "map.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    const importBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Import"),
    );
    expect(importBtn!.disabled).toBe(false);
  });

  it("calls onImport with file when import button clicked", () => {
    const onImport = vi.fn();
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={onImport} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "map.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    const importBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Import"),
    );
    fireEvent.click(importBtn!);
    expect(onImport).toHaveBeenCalledWith(file);
  });

  it("clears selected file when clear button clicked", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "map.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    expect(container.textContent).toContain("map.zip");
    // The clear button uses fileClearBtn class and is inside the drop zone
    const clearBtn = container.querySelector('[class*="fileClearBtn"]') as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    fireEvent.click(clearBtn);
    expect(container.textContent).toContain("Select a .zip file");
  });

  it("accepts dropped .zip file", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const dropZone = container.querySelector('[class*="dropZone"]');
    expect(dropZone).not.toBeNull();
    const file = new File(["data"], "dropped.zip", { type: "application/zip" });
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [file] },
    });
    expect(container.textContent).toContain("dropped.zip");
  });

  it("handles dragOver and dragLeave", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <ImportDialog onImport={() => {}} onClose={() => {}} uploading={false} uploadProgress={0} uploadError={null} />
      </I18nProvider>
    ));
    const dropZone = container.querySelector('[class*="dropZone"]');
    expect(dropZone).not.toBeNull();
    fireEvent.dragOver(dropZone!);
    fireEvent.dragLeave(dropZone!);
  });
});

// ─── DeleteConfirm ───

describe("DeleteConfirm", () => {
  const testMap: MapInfo = {
    name: "Tanoa",
    status: "complete",
  };

  it("renders map name in confirmation", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <DeleteConfirm map={testMap} onConfirm={() => {}} onClose={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("Delete Tanoa?");
  });

  it("renders warning text", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <DeleteConfirm map={testMap} onConfirm={() => {}} onClose={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("cannot be undone");
  });

  it("calls onConfirm when delete clicked", () => {
    const onConfirm = vi.fn();
    const { container } = render(() => (
      <I18nProvider locale="en">
        <DeleteConfirm map={testMap} onConfirm={onConfirm} onClose={() => {}} />
      </I18nProvider>
    ));
    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete"),
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onClose when cancel clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <I18nProvider locale="en">
        <DeleteConfirm map={testMap} onConfirm={() => {}} onClose={onClose} />
      </I18nProvider>
    ));
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    );
    expect(cancelBtn).toBeDefined();
    fireEvent.click(cancelBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <I18nProvider locale="en">
        <DeleteConfirm map={testMap} onConfirm={() => {}} onClose={onClose} />
      </I18nProvider>
    ));
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalled();
  });
});
