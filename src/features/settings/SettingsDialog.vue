<script setup lang="ts">
import { computed, ref } from "vue";
import { t, locale } from "@/shared/i18n/locale";
import { categories, useEditor } from "@/features/settings/useEditor";
import { useDiagnostics } from "@/features/settings/useDiagnostics";
import AppearanceOptions from "@/features/settings/appearance/AppearanceOptions.vue";
import GeneralOptions from "@/features/settings/GeneralOptions.vue";
import PageOptions from "@/features/settings/pages/PageOptions.vue";
import PlaybackOptions from "@/features/settings/PlaybackOptions.vue";
import LyricsOptions from "@/features/settings/LyricsOptions.vue";
import LibraryOptions from "@/features/settings/LibraryOptions.vue";
import AdvancedOptions from "@/features/settings/AdvancedOptions.vue";
import ShortcutOptions from "@/features/shortcuts/ShortcutOptions.vue";
import AboutPanel from "@/features/settings/AboutPanel.vue";
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const {
  session,
  draft,
  selectedCategory,
  isBackingUp,
  isChangingLogging,
  isTauriApp,
  isLoading,
  isLoaded,
  isSaving,
  show,
  close,
  save,
  onDialogClosed,
} = useEditor(dialogElement);
const diagnostics = useDiagnostics(isChangingLogging);
const disabled = computed(
  () => !isTauriApp || !isLoaded.value || isLoading.value || isSaving.value,
);
const playbackLabel = computed(() => (locale.value === "en" ? "Playback" : "播放"));
defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="settings-dialog-title"
    class="sidebar-scrollbars bg-app-surface m-auto w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="close"
    @close="onDialogClosed"
    @click.self="close"
    @mousedown.stop
  >
    <form class="flex h-[min(36rem,85dvh)] flex-col" @submit.prevent="save">
      <header class="shrink-0 border-b border-white/10 px-5 py-4">
        <h2 id="settings-dialog-title" class="text-lg font-semibold">{{ t("设置") }}</h2>
      </header>
      <div
        class="grid min-h-0 flex-1 grid-cols-[7rem_minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)]"
      >
        <nav
          :aria-label="t('设置分类')"
          class="bg-app-base/40 overflow-y-auto border-r border-white/10 p-2 sm:p-3"
        >
          <button
            v-for="(label, category) in categories"
            :id="`settings-category-${category}`"
            :key="category"
            :aria-current="selectedCategory === category ? 'true' : undefined"
            :disabled="isBackingUp"
            aria-controls="settings-category-panel"
            class="focus-visible:outline-app-accent mb-1 w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="
              selectedCategory === category
                ? 'bg-app-accent text-app-on-accent'
                : 'text-app-muted hover:bg-white/5 hover:text-white'
            "
            type="button"
            @click="selectedCategory = category"
          >
            {{ category === "playback" ? playbackLabel : t(label) }}
          </button>
        </nav>
        <section
          id="settings-category-panel"
          :aria-labelledby="`settings-category-${selectedCategory}`"
          class="min-h-0 min-w-0 p-5 sm:p-6"
          :class="
            selectedCategory === 'shortcuts' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
          "
        >
          <AppearanceOptions
            v-if="selectedCategory === 'appearance'"
            :draft="draft"
            :disabled="disabled"
          />
          <GeneralOptions
            v-else-if="selectedCategory === 'general'"
            :draft="draft"
            :disabled="disabled"
          />
          <PageOptions
            v-else-if="selectedCategory === 'pages'"
            v-model="draft.pages"
            :disabled="disabled"
          />
          <LyricsOptions
            v-else-if="selectedCategory === 'lyrics'"
            :draft="draft"
            :disabled="disabled"
          />
          <AboutPanel v-else-if="selectedCategory === 'about'" />
          <AdvancedOptions
            v-else-if="selectedCategory === 'advanced'"
            :draft="draft"
            :disabled="disabled"
            :is-tauri-app="isTauriApp"
            :is-backing-up="isBackingUp"
            :diagnostics="diagnostics"
            @busy="isBackingUp = $event"
          />
          <PlaybackOptions
            v-else-if="selectedCategory === 'playback'"
            :draft="draft"
            :disabled="disabled"
          />
          <LibraryOptions
            v-else-if="selectedCategory === 'library'"
            :draft="draft"
            :disabled="disabled"
          />
          <KeepAlive>
            <ShortcutOptions
              v-if="selectedCategory === 'shortcuts'"
              v-model="draft.shortcuts"
              :disabled="disabled"
              :session="session"
            />
          </KeepAlive>
        </section>
      </div>
      <p v-if="isLoading" class="text-app-muted px-5 pb-4 text-sm" role="status">
        {{ t("正在读取设置…") }}
      </p>
      <footer class="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          :disabled="isSaving || isBackingUp"
          type="button"
          @click="close"
        >
          {{ t("取消") }}
        </button>
        <button
          v-if="selectedCategory !== 'about'"
          class="bg-app-accent text-app-on-accent focus-visible:outline-app-accent rounded-full px-5 py-2 text-sm font-semibold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isTauriApp || !isLoaded || isLoading || isSaving || isBackingUp"
          type="submit"
        >
          {{ isSaving ? t("正在保存…") : t("保存") }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
