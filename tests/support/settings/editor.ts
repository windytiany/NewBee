import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { evaluateSource, transpileScript } from "../module/loader";
import { createHostNode, createHostRenderer } from "../host/renderer";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";
import { cloneShortcuts, DEFAULT_SHORTCUTS } from "@/features/shortcuts/bindings";
import * as AccentColor from "@/features/settings/appearance/accent";
import type { NotificationInput } from "@/shared/notifications/center";
import type { useEditor } from "@/features/settings/useEditor";
import type { useDiagnostics } from "@/features/settings/useDiagnostics";
export type EditorBindings = ReturnType<typeof useEditor> & {
  diagnostics: ReturnType<typeof useDiagnostics>;
};
export const defaults: Settings = {
  themeMode: "system",
  locale: "zh-CN",
  accentColor: AccentColor.DEFAULT_ACCENT_COLOR,
  reducedMotion: false,
  layoutDensity: "regular",
  albumCoverBackground: false,
  playingCoverBackground: false,
  closeBehavior: "tray",
  lightweightOnClose: false,
  checkUpdatesOnStartup: true,
  showPlaybackStatistics: true,
  replayGain: true,
  replayGainPreamp: 0,
  scanReplayGain: false,
  synchronizationFolders: [],
  albumSortBy: "name",
  albumSortOrder: "ascending",
  lyricsProviders: ["netease"],
  neteaseLyricsMode: "original",
  shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
};

const icon = Vue.defineComponent({ setup: () => () => Vue.h("svg") });
export const icons = { RotateCcw: icon, Undo2: icon };
export const filename = "src/features/settings/SettingsDialog.vue";
export const source = await Bun.file(
  new URL("../../../src/features/settings/SettingsDialog.vue", import.meta.url),
).text();
const output = transpileScript(
  await Bun.file(new URL("../../../src/features/settings/useEditor.ts", import.meta.url)).text(),
);
const diagnosticOutput = transpileScript(
  await Bun.file(
    new URL("../../../src/features/settings/useDiagnostics.ts", import.meta.url),
  ).text(),
);
const apps: Vue.App[] = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
export function cleanupEditor() {
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
}
export function createEditor(
  invoke: (command: string, args?: unknown) => Promise<unknown>,
  suspend: (suspended: boolean) => Promise<void> = async () => {},
  lifecycle: { confirm?: () => Promise<boolean>; idle?: () => Promise<void> } = {},
) {
  let releaseGuard: ((signal: AbortSignal) => Promise<boolean>) | undefined;
  let active = () => false;
  let guardRemoved = false;
  const events: string[] = [];
  const suspensions: boolean[] = [];
  const feedback: NotificationInput[] = [];
  const appliedThemes: Settings["themeMode"][] = [];
  const appliedColors: Settings["accentColor"][] = [];
  const appliedMotion: boolean[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@lucide/vue": icons,
    "@tauri-apps/plugin-dialog": { ask: lifecycle.confirm ?? (async () => false) },
    "@/shared/lifecycle/activity": {
      watchActivity: (read: () => boolean) => {
        active = read;
        return () => {};
      },
      beforeRelease: (guard: typeof releaseGuard) => {
        releaseGuard = guard;
        return () => {
          guardRemoved = true;
        };
      },
      waitForIdle: lifecycle.idle ?? (async () => {}),
    },
    "@/shared/notifications/center": { notify: (input: NotificationInput) => feedback.push(input) },
    "@/features/backup/BackupOptions.vue": Vue.defineComponent({ template: "<div />" }),
    "@/features/settings/AboutPanel.vue": Vue.defineComponent({ template: "<div />" }),
    "@/shared/update/UpdatePanel.vue": Vue.defineComponent({ render: () => null }),
    "@/features/library/synchronization/SynchronizationOptions.vue": Vue.defineComponent({
      template: "<div />",
    }),
    "@tauri-apps/api/core": {
      invoke: async (command: string, args?: unknown) => {
        if (command === "set_shortcuts_suspended") {
          suspensions.push(
            Boolean(args && typeof args === "object" && "suspended" in args && args.suspended),
          );
          await suspend(suspensions[suspensions.length - 1]!);
          return;
        }
        return invoke(command, args);
      },
      isTauri: () => true,
    },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
    "@/features/settings/appearance/accent": AccentColor,
    "@/features/settings/appearance/apply": {
      applyAppearance: (settings: Settings) => {
        appliedThemes.push(settings.themeMode);
        appliedColors.push(settings.accentColor);
        appliedMotion.push(settings.reducedMotion);
      },
    },
  };
  const editor = evaluateSource<{ useEditor: typeof useEditor }>(output, modules);
  const diagnostics = evaluateSource<{ useDiagnostics: typeof useDiagnostics }>(
    diagnosticOutput,
    modules,
  );
  let bindings!: EditorBindings;
  const app = createHostRenderer(createHostNode).createApp(
    Vue.defineComponent({
      setup() {
        const state = editor.useEditor();
        bindings = { ...state, diagnostics: diagnostics.useDiagnostics(state.isChangingLogging) };
        return () => null;
      },
    }),
  );
  app.mount(createHostNode("root"));
  apps.push(app);
  const element = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
  bindings.dialogElement.value = element as HTMLDialogElement;
  return {
    bindings,
    element,
    events,
    appliedThemes,
    appliedColors,
    appliedMotion,
    feedback,
    suspensions,
    isActive: () => active(),
    isGuardRemoved: () => guardRemoved,
    unmount: () => {
      apps.splice(apps.indexOf(app), 1);
      app.unmount();
    },
    prepareRelease: (signal = new AbortController().signal) => releaseGuard!(signal),
  };
}
export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
