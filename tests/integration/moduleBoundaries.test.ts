import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { posix as path } from "node:path";
import { parse } from "@vue/compiler-sfc";
import {
  createSourceFile,
  isExportDeclaration,
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
  ScriptTarget,
  SyntaxKind,
} from "typescript";

const sourceRoot = new URL("../../src/", import.meta.url);
function sourceFiles(directory = ""): string[] {
  return readdirSync(new URL(directory, sourceRoot), { withFileTypes: true }).flatMap((entry) => {
    const filename = `${directory}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${filename}/`);
    return /\.(ts|vue)$/.test(filename) ? [filename] : [];
  });
}
const filenames = sourceFiles();
const knownFiles = new Set(filenames);
type Dependency = { source: string; target: string; runtime: boolean };
const dependencies: Dependency[] = [];
const unresolved: string[] = [];
for (const filename of filenames) {
  const source = readFileSync(new URL(filename, sourceRoot), "utf8");
  let scripts = [source];
  if (filename.endsWith(".vue")) {
    const { descriptor, errors } = parse(source, { filename });
    if (errors.length) throw new Error(`Cannot parse ${filename}: ${errors.join("\n")}`);
    scripts = [descriptor.script?.content ?? "", descriptor.scriptSetup?.content ?? ""];
  }
  for (const script of scripts) {
    const tree = createSourceFile(filename, script, ScriptTarget.Latest, true);
    for (const statement of tree.statements) {
      if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) continue;
      const candidate = specifier.startsWith("@/")
        ? specifier.slice(2)
        : path.normalize(path.join(path.dirname(filename), specifier));
      if (candidate.endsWith(".css")) continue;
      const target = [candidate, `${candidate}.ts`, `${candidate}.vue`].find((file) =>
        knownFiles.has(file),
      );
      if (!target) {
        unresolved.push(`${filename} -> ${specifier}`);
        continue;
      }
      let runtime = true;
      if (isExportDeclaration(statement)) runtime = !statement.isTypeOnly;
      else if (statement.importClause) {
        const clause = statement.importClause;
        runtime = clause.phaseModifier !== SyntaxKind.TypeKeyword;
        if (
          !clause.name &&
          clause.namedBindings &&
          isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every((binding) => binding.isTypeOnly)
        )
          runtime = false;
      }
      dependencies.push({ source: filename, target, runtime });
    }
  }
}

describe("frontend module boundaries", () => {
  it("resolves every local source import", () => {
    expect(unresolved).toEqual([]);
  });

  it("keeps shared code independent of business features and application wiring", () => {
    expect(
      dependencies.filter(
        ({ source, target }) => source.startsWith("shared/") && !target.startsWith("shared/"),
      ),
    ).toEqual([]);
    expect(
      dependencies.filter(
        ({ source, target }) => source.startsWith("features/") && target.startsWith("app/"),
      ),
    ).toEqual([]);
  });

  it("limits other features to playback session contracts and UI components", () => {
    expect(
      dependencies.filter(
        ({ source, target }) =>
          source.startsWith("features/") &&
          !source.startsWith("features/playback/") &&
          target.startsWith("features/playback/") &&
          target !== "features/playback/session.ts" &&
          target !== "features/playback/types.ts" &&
          !target.startsWith("features/playback/components/") &&
          !target.startsWith("features/playback/queue/components/"),
      ),
    ).toEqual([]);
    expect(
      dependencies.filter(
        ({ source, target }) =>
          source === "app/shell/AppShell.vue" && target.startsWith("features/"),
      ),
    ).toEqual([]);
  });

  it("has no runtime import cycles, while allowing type-only contracts", () => {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycles: string[] = [];
    const outgoing = new Map<string, string[]>();
    for (const { source, target, runtime } of dependencies) {
      if (runtime) outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
    }
    function visit(filename: string, trail: string[]) {
      if (visiting.has(filename)) {
        cycles.push([...trail, filename].join(" -> "));
        return;
      }
      if (visited.has(filename)) return;
      visiting.add(filename);
      for (const target of outgoing.get(filename) ?? []) visit(target, [...trail, filename]);
      visiting.delete(filename);
      visited.add(filename);
    }
    for (const filename of filenames) visit(filename, []);
    expect(cycles).toEqual([]);
  });
});
