import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

export function transpileScript(source: string) {
  return transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
}

export function compileSfc(
  source: string,
  filename: string,
  { id = filename, inlineTemplate = true }: { id?: string; inlineTemplate?: boolean } = {},
) {
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) throw new Error(`Cannot compile ${filename}: ${errors.join("\n")}`);
  return transpileScript(compileScript(descriptor, { id, inlineTemplate }).content);
}

/** Evaluates a fresh module with only the dependencies supplied by its caller. */
export function evaluateModule<Exports = Record<string, unknown>>(
  output: string,
  dependencies: Record<string, unknown>,
): Exports {
  const module = { exports: {} as Exports };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name))
        throw new Error(`Missing test dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}

/** Paths are relative to src/ and ordered explicitly by the feature fixture. */
export async function loadSourceModules(
  paths: readonly string[],
  dependencies: Record<string, unknown>,
) {
  for (const path of paths) {
    const source = await Bun.file(new URL(`../../src/${path}`, import.meta.url)).text();
    const isView = path.endsWith(".vue");
    const output = isView
      ? compileSfc(source, `src/${path}`, { id: path })
      : transpileScript(source);
    dependencies[`@/${isView ? path : path.slice(0, -3)}`] = evaluateModule(output, dependencies);
  }
}
