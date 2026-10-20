import { describe, expect, test } from "bun:test";

const stylesheet = await Bun.file(
  new URL("../../../src/app/styles/main.css", import.meta.url),
).text();

describe("global text selection", () => {
  test("disables selection explicitly on the body and native dialogs", () => {
    expect(stylesheet).toMatch(/body,\s*dialog\s*\{\s*user-select:\s*none;/);
  });

  test("keeps text selection enabled in editable controls", () => {
    expect(stylesheet).toMatch(
      /input,\s*textarea,\s*\[contenteditable\]:not\(\[contenteditable="false"\]\)\s*\{\s*user-select:\s*text;/,
    );
  });
});
