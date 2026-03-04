import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { FocusToolbar } from "../components/FocusToolbar";
import type { FocusRange } from "../components/FocusToolbar";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
  unitDef,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderToolbar(draft: FocusRange | null = { inFrame: 50, outFrame: 250 }) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest([unitDef()], [], 300));

  const [draftSignal] = createSignal<FocusRange | null>(draft);
  const callbacks = {
    onSetIn: vi.fn(),
    onSetOut: vi.fn(),
    onClear: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
  };

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <FocusToolbar draft={draftSignal} {...callbacks} />
    </TestProviders>
  ));

  return { engine, ...callbacks, ...result };
}

describe("FocusToolbar", () => {
  it("renders Focus Range label", () => {
    renderToolbar();
    expect(screen.getByText("Focus Range")).toBeTruthy();
  });

  it("shows time range when draft is set", () => {
    renderToolbar({ inFrame: 50, outFrame: 250 });
    // Arrow separator is rendered via &rarr; which becomes →
    const rangeEl = document.querySelector('[class*="focusToolbarRange"]');
    expect(rangeEl).not.toBeNull();
    expect(rangeEl!.textContent).toContain("→");
  });

  it("hides time range when draft is null", () => {
    renderToolbar(null);
    const rangeEl = document.querySelector('[class*="focusToolbarRange"]');
    expect(rangeEl).toBeNull();
  });

  it("Set In button calls onSetIn", () => {
    const { onSetIn } = renderToolbar();
    fireEvent.click(screen.getByText("Set In").closest("button")!);
    expect(onSetIn).toHaveBeenCalledOnce();
  });

  it("Set Out button calls onSetOut", () => {
    const { onSetOut } = renderToolbar();
    fireEvent.click(screen.getByText("Set Out").closest("button")!);
    expect(onSetOut).toHaveBeenCalledOnce();
  });

  it("Clear button calls onClear", () => {
    const { onClear } = renderToolbar();
    fireEvent.click(screen.getByText("Clear").closest("button")!);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("Cancel button calls onCancel", () => {
    const { onCancel } = renderToolbar();
    fireEvent.click(screen.getByText("Cancel").closest("button")!);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Save button calls onSave", () => {
    const { onSave } = renderToolbar();
    fireEvent.click(screen.getByText("Save").closest("button")!);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("Set In button has gold styling", () => {
    renderToolbar();
    const btn = screen.getByText("Set In").closest("button")!;
    expect(btn.className).toMatch(/focusToolbarGold/);
  });

  it("Save button has save styling", () => {
    renderToolbar();
    const btn = screen.getByText("Save").closest("button")!;
    expect(btn.className).toMatch(/focusToolbarSave/);
  });

  it("buttons display keyboard shortcut hints", () => {
    renderToolbar();
    const setInBtn = screen.getByText("Set In").closest("button")!;
    const cancelBtn = screen.getByText("Cancel").closest("button")!;
    expect(setInBtn.querySelector("kbd")?.textContent).toBe("I");
    expect(cancelBtn.querySelector("kbd")?.textContent).toBe("Esc");
  });
});
