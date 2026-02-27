import { createSignal } from "solid-js";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { SelectDropdown } from "../SelectDropdown";

afterEach(() => {
  cleanup();
});

const OPTIONS = ["a", "b", "c"] as const;

function renderDropdown(opts?: {
  isDisabled?: (o: string) => boolean;
  wide?: boolean;
}) {
  const [value, setValue] = createSignal<string>("a");

  const result = render(() => (
    <SelectDropdown
      value={value}
      options={[...OPTIONS]}
      getLabel={(o) => `Label ${o.toUpperCase()}`}
      onSelect={setValue}
      isDisabled={opts?.isDisabled}
      wide={opts?.wide}
    />
  ));

  return { value, setValue, ...result };
}

describe("SelectDropdown", () => {
  it("renders the current value label", () => {
    renderDropdown();
    expect(screen.getByText("Label A")).toBeTruthy();
  });

  it("opens dropdown on click and shows all options", () => {
    renderDropdown();

    // Options not visible initially
    expect(screen.queryByText("Label B")).toBeNull();
    expect(screen.queryByText("Label C")).toBeNull();

    // Open
    fireEvent.click(screen.getByText("Label A").closest("button")!);

    // All options visible (Label A appears both in trigger and dropdown)
    expect(screen.getAllByText("Label A").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Label B")).toBeTruthy();
    expect(screen.getByText("Label C")).toBeTruthy();
  });

  it("selects an option and closes dropdown", () => {
    const { value } = renderDropdown();

    // Open
    fireEvent.click(screen.getByText("Label A").closest("button")!);

    // Select B
    const optionB = screen.getAllByText("Label B").find(
      (el) => el.tagName === "BUTTON",
    )!;
    fireEvent.click(optionB);

    expect(value()).toBe("b");

    // Dropdown should be closed (Label C only appeared in dropdown)
    expect(screen.queryByText("Label C")).toBeNull();

    // Trigger now shows Label B
    expect(screen.getByText("Label B")).toBeTruthy();
  });

  it("does not select a disabled option", () => {
    const { value } = renderDropdown({
      isDisabled: (o) => o === "b",
    });

    // Open
    fireEvent.click(screen.getByText("Label A").closest("button")!);

    // The disabled option's button should have disabled attribute
    const optionB = screen.getAllByText("Label B").find(
      (el) => el.tagName === "BUTTON",
    )! as HTMLButtonElement;
    expect(optionB.disabled).toBe(true);

    // Click the disabled option — value should not change
    fireEvent.click(optionB);
    expect(value()).toBe("a");
  });

  it("closes dropdown on outside click", () => {
    renderDropdown();

    // Open
    fireEvent.click(screen.getByText("Label A").closest("button")!);
    expect(screen.getByText("Label B")).toBeTruthy();

    // Click outside
    fireEvent(document, new MouseEvent("pointerdown", { bubbles: true }));

    // Dropdown should be closed
    expect(screen.queryByText("Label B")).toBeNull();
  });

  it("closes dropdown on toggle click", () => {
    renderDropdown();

    const trigger = screen.getByText("Label A").closest("button")!;

    // Open
    fireEvent.click(trigger);
    expect(screen.getByText("Label B")).toBeTruthy();

    // Close by clicking trigger again
    fireEvent.click(trigger);
    expect(screen.queryByText("Label B")).toBeNull();
  });
});
