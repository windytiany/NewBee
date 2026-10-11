import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";

const projectRoot = new URL("../../", import.meta.url);
const toolchainFiles = new Set(["src/vite-env.d.ts"]);

function invalidPaths(directory: string): string[] {
  return readdirSync(new URL(`${directory}/`, projectRoot), { withFileTypes: true }).flatMap(
    (entry) => {
      const filename = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return [
          ...(/^[a-z][a-z0-9]*$/.test(entry.name) ? [] : [filename]),
          ...invalidPaths(filename),
        ];
      }
      if (entry.name.endsWith(".vue") || toolchainFiles.has(filename)) return [];
      const stem = entry.name.replace(/(?:\.test)?\.[^.]+$/, "");
      if (/^use[A-Z][a-zA-Z0-9]*$/.test(stem) && entry.name.endsWith(".ts")) return [];
      return /^[A-Za-z][a-z0-9]*$/.test(stem) ? [] : [filename];
    },
  );
}

test("module directories express ownership and non-Vue files name one responsibility", () => {
  expect(["src", "src-tauri/src", "tests"].flatMap(invalidPaths)).toEqual([]);
});
