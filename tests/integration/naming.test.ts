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

test("frontend directories express ownership instead of technical categories", () => {
  const paths = ["src/features", "src/shared", "tests/features", "tests/shared"].flatMap(
    (directory) =>
      readdirSync(new URL(`${directory}/`, projectRoot), {
        recursive: true,
        withFileTypes: true,
      })
        .filter(
          (entry) =>
            entry.isDirectory() && ["components", "composables", "pages"].includes(entry.name),
        )
        .map((entry) => `${entry.parentPath}/${entry.name}`.split("\\").join("/")),
  );
  expect(paths.sort()).toEqual([]);
});

test("backend tests use owned tests directories instead of tests.rs", () => {
  const directory = "src-tauri/src";
  const paths = readdirSync(new URL(`${directory}/`, projectRoot), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name === "tests.rs")
    .map((entry) => `${entry.parentPath}/${entry.name}`.split("\\").join("/"))
    .sort();
  expect(paths).toEqual([]);
});
