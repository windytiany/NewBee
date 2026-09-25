<template>
  <header
    class="bg-spotify-base fixed inset-x-0 top-0 z-50 grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 text-white sm:px-6"
    @mousedown.left="startDragging"
  >
    <span class="justify-self-start text-base font-bold whitespace-nowrap sm:text-lg">NewBee</span>

    <nav
      aria-label="Main navigation"
      class="bg-spotify-interactive inline-flex items-center rounded-full p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
    >
      <button
        v-for="pageName in pageNames"
        :key="pageName"
        :aria-pressed="props.activePage === pageName"
        class="focus-visible:outline-spotify-green rounded-full px-2 py-2 text-xs font-semibold tracking-[1px] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-4 sm:text-sm sm:tracking-[1.4px]"
        :class="
          props.activePage === pageName
            ? 'bg-spotify-green text-black'
            : 'text-spotify-muted hover:text-white'
        "
        type="button"
        @click="emit('update:activePage', pageName)"
      >
        {{ pageName }}
      </button>
    </nav>

    <div
      v-if="isTauriApp"
      aria-label="Window controls"
      class="absolute inset-y-0 right-0 flex h-full items-center"
      role="group"
    >
      <button
        aria-label="Minimize window"
        class="text-spotify-muted focus-visible:outline-spotify-green grid h-full w-10 place-items-center transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
        title="Minimize"
        type="button"
        @click.stop="minimizeWindow"
      >
        <Minus aria-hidden="true" class="size-4" />
      </button>
      <button
        :aria-label="isMaximized ? 'Restore window' : 'Maximize window'"
        class="text-spotify-muted focus-visible:outline-spotify-green grid h-full w-10 place-items-center transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
        :title="isMaximized ? 'Restore' : 'Maximize'"
        type="button"
        @click.stop="toggleMaximizeWindow"
      >
        <Copy v-if="isMaximized" aria-hidden="true" class="size-3.5" />
        <Maximize v-else aria-hidden="true" class="size-3.5" />
      </button>
      <button
        aria-label="Close window"
        class="text-spotify-muted focus-visible:outline-spotify-green grid h-full w-11 place-items-center transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-2"
        title="Close"
        type="button"
        @click.stop="closeWindow"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { isTauri } from "@tauri-apps/api/core";
import { pageNames, type PageName } from "../types/pages";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Maximize, Minus, X } from "@lucide/vue";
import { onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{ activePage: PageName }>();
const emit = defineEmits<{
  "update:activePage": [pageName: PageName];
}>();
const isTauriApp = isTauri();
const appWindow = isTauriApp ? getCurrentWindow() : null;
const isMaximized = ref(false);
let unlistenResize: (() => void) | undefined;

async function performWindowAction(action: () => Promise<void>, description: string) {
  try {
    await action();
  } catch (error) {
    globalThis.console.error(`Failed to ${description} the window.`, error);
  }
}

async function syncMaximizedState() {
  if (!appWindow) return;

  try {
    isMaximized.value = await appWindow.isMaximized();
  } catch (error) {
    globalThis.console.error("Failed to read the window maximized state.", error);
  }
}

function startDragging(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (
    !appWindow ||
    (event.target instanceof globalThis.Element && event.target.closest("button, nav"))
  ) {
    return;
  }

  void performWindowAction(() => appWindow.startDragging(), "start dragging");
}

async function minimizeWindow() {
  if (!appWindow) return;
  await performWindowAction(() => appWindow.minimize(), "minimize");
}

async function toggleMaximizeWindow() {
  if (!appWindow) return;

  await performWindowAction(() => appWindow.toggleMaximize(), "toggle maximize");
  await syncMaximizedState();
}

async function closeWindow() {
  if (!appWindow) return;
  await performWindowAction(() => appWindow.close(), "close");
}

onMounted(async () => {
  if (!appWindow) return;

  await syncMaximizedState();

  try {
    unlistenResize = await appWindow.onResized(() => {
      void syncMaximizedState();
    });
  } catch (error) {
    globalThis.console.error("Failed to listen for window resize events.", error);
  }
});

onUnmounted(() => {
  unlistenResize?.();
});
</script>
