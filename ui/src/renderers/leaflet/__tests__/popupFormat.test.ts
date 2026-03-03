import { describe, it, expect } from "vitest";
import { formatPopupContent } from "../popupFormat";

describe("formatPopupContent", () => {
  it("returns escaped name for units (no crew)", () => {
    expect(formatPopupContent("Alpha 1")).toBe("Alpha 1");
  });

  it("escapes HTML in unit names", () => {
    expect(formatPopupContent("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(formatPopupContent("Tank & <APC>")).toBe("Tank &amp; &lt;APC&gt;");
  });

  it("shows (0) for vehicle with no crew", () => {
    expect(formatPopupContent("HMMWV", { count: 0, names: [] })).toBe(
      "HMMWV <i>(0)</i>",
    );
  });

  it("shows count only when all crew are AI (no player names)", () => {
    expect(formatPopupContent("HMMWV", { count: 3, names: [] })).toBe(
      "HMMWV <i>(3)</i>",
    );
  });

  it("shows vehicle name + crew count + player names", () => {
    const result = formatPopupContent("HMMWV", {
      count: 2,
      names: ["Driver", "Gunner"],
    });
    expect(result).toBe("<u>HMMWV</u> <i>(2)</i><br>Driver<br>Gunner");
  });

  it("escapes HTML in vehicle name and crew names", () => {
    const result = formatPopupContent("Tank & <APC>", {
      count: 1,
      names: ["<script>alert(1)</script>"],
    });
    expect(result).toContain("Tank &amp; &lt;APC&gt;");
    expect(result).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("shows mixed crew: count includes AI, names list only players", () => {
    const result = formatPopupContent("Heli", {
      count: 4,
      names: ["Player1", "Player2"],
    });
    expect(result).toBe("<u>Heli</u> <i>(4)</i><br>Player1<br>Player2");
  });
});
