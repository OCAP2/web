import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { EditModal, DeleteConfirm } from "../dialogs";
import type { Recording } from "../../../data/types";

const mockRec: Recording = {
  id: "42",
  worldName: "Altis",
  missionName: "Op Thunder",
  missionDuration: 3600,
  date: "2000-01-01T01:01:01.000+09:00",
  tag: "TvT",
  storageFormat: "protobuf",
  conversionStatus: "completed",
};

// Input date converted to UTC: 2000-01-01T01:01:01+09:00 = 1999-12-31T16:01:01Z
const expectedDateUTC = "1999-12-31T16:01:01.000Z";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ─── EditModal ───

describe("EditModal", () => {
  it("renders with operation data", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(() => (
      <EditModal rec={mockRec} tags={[]} onClose={onClose} onSave={onSave} />
    ));

    expect(screen.getByText("Edit Recording")).not.toBeNull();
    expect(screen.getByText("#42")).not.toBeNull();
    expect(screen.getByText("Altis")).not.toBeNull();
    expect(screen.getByDisplayValue("Op Thunder")).not.toBeNull();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(() => (
      <EditModal rec={mockRec} tags={[]} onClose={onClose} onSave={onSave} />
    ));

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onSave with updated data on form submit", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    const { container } = render(() => (
      <EditModal rec={mockRec} tags={[]} onClose={onClose} onSave={onSave} />
    ));

    const nameInput = screen.getByDisplayValue("Op Thunder");
    fireEvent.input(nameInput, { target: { value: "Op Lightning" } });

    fireEvent.submit(container.querySelector("form")!);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("42", {
      missionName: "Op Lightning",
      tag: "TvT",
      date: expectedDateUTC,
    });
  });

  it("shows tag input and allows free-form entry", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    const { container } = render(() => (
      <EditModal rec={mockRec} tags={["TvT", "COOP"]} onClose={onClose} onSave={onSave} />
    ));

    // Tag input should show current value
    const tagInput = screen.getByPlaceholderText("e.g. TvT, COOP, Zeus") as HTMLInputElement;
    expect(tagInput.value).toBe("TvT");

    // Type a custom tag
    fireEvent.input(tagInput, { target: { value: "CustomTag" } });

    // Submit and verify the new tag is sent
    fireEvent.submit(container.querySelector("form")!);
    expect(onSave).toHaveBeenCalledWith("42", {
      missionName: "Op Thunder",
      tag: "CustomTag",
      date: expectedDateUTC,
    });
  });

  it("round-trips ISO date with timezone offset as UTC", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    const { container } = render(() => (
      <EditModal rec={mockRec} tags={[]} onClose={onClose} onSave={onSave} />
    ));

    // Submit without changing the date
    fireEvent.submit(container.querySelector("form")!);

    expect(onSave).toHaveBeenCalledWith("42", expect.objectContaining({
      date: expectedDateUTC,
    }));
  });
});

// ─── DeleteConfirm ───

describe("DeleteConfirm", () => {
  it("renders delete confirmation with operation name", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(() => (
      <DeleteConfirm rec={mockRec} onClose={onClose} onConfirm={onConfirm} />
    ));

    expect(screen.getAllByText("Delete Recording").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Op Thunder")).not.toBeNull();
  });

  it("shows warning text about permanent deletion", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(() => (
      <DeleteConfirm rec={mockRec} onClose={onClose} onConfirm={onConfirm} />
    ));

    expect(
      screen.getByText((content) => content.includes("cannot be undone")),
    ).not.toBeNull();
  });

  it("calls onConfirm with operation id when delete button clicked", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(() => (
      <DeleteConfirm rec={mockRec} onClose={onClose} onConfirm={onConfirm} />
    ));

    // The delete button contains both an icon and text "Delete Recording";
    // use getAllByText since the heading also says "Delete Recording".
    const deleteButtons = screen.getAllByText("Delete Recording");
    // The second match is the button (first is the heading title)
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("42");
  });

  it("calls onClose when Cancel clicked", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(() => (
      <DeleteConfirm rec={mockRec} onClose={onClose} onConfirm={onConfirm} />
    ));

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
