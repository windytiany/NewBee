import { describe, expect, test } from "bun:test";

const stylesheet = await Bun.file(new URL("../../src/app/styles/main.css", import.meta.url)).text();
const selector = "select:not([multiple]):not([size])";
const selectRule = stylesheet.slice(stylesheet.indexOf(selector)).split("}")[0];

describe("global select styles", () => {
  test("insets the arrow and reserves room without changing the control background color", () => {
    expect(selectRule).toContain("appearance: none;");
    expect(selectRule).toContain("padding-right: 2.5rem;");
    expect(selectRule).toContain("background-image: url(");
    expect(selectRule).toContain("background-repeat: no-repeat;");
    expect(selectRule).toContain("background-position: right 0.75rem center;");
    expect(selectRule).toContain("background-size: 1rem;");
    expect(selectRule).not.toContain("background-color:");
  });

  test("restores the system arrow in forced-colors mode", () => {
    const forcedColorsRule = stylesheet.slice(stylesheet.indexOf("@media (forced-colors: active)"));
    expect(forcedColorsRule).toContain(selector);
    expect(forcedColorsRule).toContain("appearance: auto;");
    expect(forcedColorsRule).toContain("background-image: none;");
  });
});
