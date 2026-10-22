import { loggingDependencies } from "../logging";
import * as i18n from "@/shared/i18n/locale";
import * as taskQueue from "@/features/tasks/queue";
import { taskCommands } from "@/features/tasks/commands";

const sharedDependencies = {
  ...loggingDependencies,
  "@/shared/i18n/locale": i18n,
  "@/features/tasks/queue": {
    ...taskQueue,
    runWriteTask: async <T>(request: { id?: string }, execute: (id: string) => Promise<T>) =>
      execute(request.id ?? "test-task"),
  },
  // Window destruction is tested with explicit lifecycle adapters.
  "@/shared/lifecycle/activity": {
    watchActivity: () => () => {},
    beforeRelease: () => () => {},
    waitForIdle: async () => {},
  },
  "@tauri-apps/plugin-dialog": { ask: async () => false },
  // Host-renderer component tests have no DOM. Exercise scroll hooks with event targets separately.
  "@/shared/interaction/scroll/persistence": { vPersistentScroll: {} },
  "@/features/tracks/selection/useKeyboard": { useTrackSelectionKeyboard: () => {} },
};
import { readFileSync } from "node:fs";
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
  dependencies = { ...sharedDependencies, ...commandAdapters(dependencies), ...dependencies };
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
    const source = await Bun.file(new URL(`../../../src/${path}`, import.meta.url)).text();
    const isView = path.endsWith(".vue");
    const output = isView
      ? compileSfc(source, `src/${path}`, { id: path })
      : transpileScript(source);
    dependencies[`@/${isView ? path : path.slice(0, -3)}`] = evaluateSource(output, dependencies);
  }
}

function commandAdapters(dependencies: Record<string, unknown>) {
  const core = dependencies["@tauri-apps/api/core"] as { invoke?: unknown } | undefined;
  // Feature fixtures exercise their command payloads. Queue scheduling has its own adapters.
  return core?.invoke
    ? { "@/features/tasks/commands": { taskInvoke: core.invoke, taskCommands } }
    : {};
}

const compiledSources = new Map<string, string>();

/** Loads real local implementations behind the explicitly supplied test adapters. */
export function evaluateSource<Exports = Record<string, unknown>>(
  output: string,
  dependencies: Record<string, unknown>,
): Exports {
  dependencies = { ...sharedDependencies, ...commandAdapters(dependencies), ...dependencies };
  const modules = new Map<string, { exports: unknown }>();
  function evaluate(source: string, module: { exports: unknown }) {
    new Function("require", "module", "exports", source)(resolve, module, module.exports);
    return module.exports;
  }
  function resolve(name: string): unknown {
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
    if (!/^@\/(?:app|features|shared)\//.test(name)) {
      throw new Error(`Missing test dependency: ${name}`);
    }
    const existing = modules.get(name);
    if (existing) return existing.exports;
    const filename = `${name.slice(2)}${name.endsWith(".vue") ? "" : ".ts"}`;
    let compiled = compiledSources.get(filename);
    if (compiled === undefined) {
      const source = readFileSync(new URL(`../../../src/${filename}`, import.meta.url), "utf8");
      compiled = filename.endsWith(".vue") ? compileSfc(source, filename) : transpileScript(source);
      compiledSources.set(filename, compiled);
    }
    const module = { exports: {} };
    modules.set(name, module);
    return evaluate(compiled, module);
  }
  return evaluate(output, { exports: {} }) as Exports;
}
