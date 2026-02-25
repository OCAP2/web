import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import {
  MessageSquareIcon,
  ZapIcon,
  EyeIcon,
  SettingsIcon,
} from "../components/Icons";

describe("Icons (uncovered)", () => {
  it("renders MessageSquareIcon", () => {
    const { container } = render(() => <MessageSquareIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders ZapIcon", () => {
    const { container } = render(() => <ZapIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders EyeIcon", () => {
    const { container } = render(() => <EyeIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders SettingsIcon", () => {
    const { container } = render(() => <SettingsIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
