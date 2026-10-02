import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const workspacePaths = [
  "library/useLibraryWorkspace.ts",
  "playlist/usePlaylistWorkspace.ts",
  "library/ui/LibraryWorkspaceContent.vue",
  "library/ui/LibraryWorkspaceDialogs.vue",
  "playlist/ui/PlaylistWorkspaceContent.vue",
  "playlist/ui/PlaylistWorkspaceDialogs.vue",
];

/** Loads real workspace code while callers substitute only its external dependencies. */
export async function loadWorkspaceModules(modules: Record<string, unknown>) {
  const bunRuntime = globalThis as typeof globalThis & {
    Bun: { file: (path: URL) => { text: () => Promise<string> } };
  };
  for (const path of workspacePaths) {
    const source = await bunRuntime.Bun.file(new URL(`../../src/${path}`, import.meta.url)).text();
    const isView = path.endsWith(".vue");
    const content = isView
      ? compileScript(parse(source, { filename: `src/${path}` }).descriptor, {
          id: path,
          inlineTemplate: true,
        }).content
      : source;
    const output = transpileModule(content, {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
      },
    }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", output)(
      (name: string) => {
        if (!(name in modules)) throw new Error(`Missing workspace test dependency: ${name}`);
        return modules[name];
      },
      module,
      module.exports,
    );
    modules[`@/${isView ? path : path.slice(0, -3)}`] = module.exports;
  }
}
