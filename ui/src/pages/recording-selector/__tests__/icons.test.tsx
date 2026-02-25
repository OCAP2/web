import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { Icons } from "../icons";

describe("Icons (uncovered)", () => {
  it("renders ArrowRight", () => {
    const { container } = render(() => <Icons.ArrowRight />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders Lock", () => {
    const { container } = render(() => <Icons.Lock />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
