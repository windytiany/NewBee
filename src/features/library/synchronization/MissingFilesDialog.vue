<script setup lang="ts">
import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onMounted, onUnmounted, ref, watch } from "vue";
import {
  synchronizationSnapshot,
  refreshSynchronization,
  resolveSynchronization,
} from "@/features/library/synchronization/state";
import { reportLibraryImport, reportLibraryMembershipChanged } from "@/features/library/events";
import { usePlaybackSession } from "@/features/playback/session";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";
import { formatPathForDisplay } from "@/shared/filesystem/presentation";

const dialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const paths = ref<string[]>([]);
const pending = ref(false);
const session = usePlaybackSession();
const synchronization = createTrackSynchronization(session, invoke);
let disposed = false;
const stops: UnlistenFn[] = [];

function reportError(error: unknown) {
  logger.error("library/synchronization", "failed", error);
  notify({ type: "error", message: t("文件夹同步失败"), key: "library-synchronization" });
}
function showPending() {
  if (
    disposed ||
    pending.value ||
    dialog.value?.open ||
    !synchronizationSnapshot.value.missing.length
  )
    return;
  paths.value = [...synchronizationSnapshot.value.missing];
  dialog.value?.showModal();
}
let failures = new Map<string, string>();
watch(synchronizationSnapshot, ({ statuses }) => {
  const next = new Map<string, string>();
  for (const status of statuses) {
    if (!status.error) continue;
    next.set(status.path, status.error);
    if (failures.get(status.path) === status.error) continue;
    notify({
      type: "warning",
      message: `${formatPathForDisplay(status.path)}: ${status.error}`,
      key: `library-synchronization:${status.path}`,
    });
  }
  failures = next;
  showPending();
});

async function resolve(clean: boolean) {
  if (pending.value) return;
  pending.value = true;
  try {
    const removed = await resolveSynchronization(paths.value, clean);
    if (removed) reportLibraryMembershipChanged();
    dialog.value?.close();
    paths.value = [];
    await refreshSynchronization();
  } catch (error) {
    reportError(error);
  } finally {
    pending.value = false;
    showPending();
  }
}

async function refreshTracks(result: { added: number; updated: number }) {
  reportLibraryImport(result);
  await session.ready;
  if (disposed) return;
  const ids = session.state.displayedTracks.value.flatMap((track) =>
    track.trackId == null ? [] : [track.trackId],
  );
  await synchronization.refresh(ids, () => !disposed);
}

onMounted(() => {
  if (!isTauri()) return;
  void (async () => {
    for (const [event, handler] of [
      ["library-synchronization-changed", () => refreshSynchronization()],
      [
        "library-synchronization-imported",
        (payload: { added: number; updated: number }) => refreshTracks(payload),
      ],
    ] as const) {
      const stop = await listen<{ added: number; updated: number }>(event, ({ payload }) => {
        void handler(payload).catch(reportError);
      });
      if (disposed) {
        stop();
        return;
      }
      stops.push(stop);
    }
    await refreshSynchronization();
    if (!disposed) await refreshTracks({ added: 0, updated: 1 });
  })().catch(reportError);
});
onUnmounted(() => {
  disposed = true;
  stops.forEach((stop) => stop());
});
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="missing-files-title"
    class="bg-app-surface m-auto w-[min(32rem,calc(100vw-2rem))] max-w-none rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="resolve(false)"
    @mousedown.stop
  >
    <header class="border-b border-white/10 px-5 py-4">
      <h2 id="missing-files-title" class="text-lg font-semibold">{{ t("清理已移除文件") }}</h2>
    </header>
    <section class="px-5 py-4">
      <p class="text-sm">
        {{ t("{count} 个文件已移除。", { count: paths.length }) }}
      </p>
      <ul class="text-app-muted mt-3 max-h-56 overflow-y-auto text-sm">
        <li v-for="path in paths" :key="path" class="py-1 break-all">
          {{ formatPathForDisplay(path) }}
        </li>
      </ul>
    </section>
    <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        :disabled="pending"
        class="rounded-full px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        @click="resolve(false)"
      >
        {{ t("保留") }}
      </button>
      <button
        type="button"
        :disabled="pending"
        class="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold hover:bg-red-400 disabled:opacity-50"
        @click="resolve(true)"
      >
        {{ pending ? t("正在处理…") : t("清理") }}
      </button>
    </footer>
  </dialog>
</template>
