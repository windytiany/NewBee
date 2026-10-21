<script lang="ts">
export type AppMenuAction = "import" | "scan" | "remap" | "settings" | "commands" | "shortcuts";
</script>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { ChevronRight } from "@lucide/vue";

import type { ShortcutSettings } from "@/features/settings/types";
import { formatShortcut } from "@/features/shortcuts/bindings";
const props = defineProps<{
  canImport: boolean;
  isImporting: boolean;
  bindings?: ShortcutSettings;
}>();
const commands = [
  { action: "commands", label: "命令面板", binding: "showCommands" },
  { action: "settings", label: "设置", binding: "showSettings" },
] as const;
const emit = defineEmits<{ select: [action: AppMenuAction] }>();
const groups = [
  {
    id: "file",
    label: "文件",
    items: [
      { action: "import", label: "导入音频文件" },
      { action: "scan", label: "扫描文件夹" },
    ],
  },
  {
    id: "tools",
    label: "工具",
    items: [
      { action: "remap", label: "路径重映射" },
      { action: "shortcuts", label: "快捷键总览" },
    ],
  },
] as const;
type SubmenuId = (typeof groups)[number]["id"];
type MenuContainer = InstanceType<typeof globalThis.HTMLDivElement>;
type MenuButton = InstanceType<typeof globalThis.HTMLButtonElement>;
type MenuElement = InstanceType<typeof globalThis.HTMLElement>;

const container = ref<MenuContainer | null>(null);
const brandButton = ref<MenuButton | null>(null);
const menuElement = ref<MenuContainer | null>(null);
const isOpen = ref(false);
const activeSubmenu = ref<SubmenuId | null>(null);

function isDisabled(action: AppMenuAction) {
  return action === "import" && (!props.canImport || props.isImporting);
}

function closeMenu(restoreFocus = false) {
  isOpen.value = false;
  activeSubmenu.value = null;
  if (restoreFocus) brandButton.value?.focus();
}

function menuItems(menu: MenuElement) {
  return [...menu.querySelectorAll<MenuButton>('button[role="menuitem"]:not(:disabled)')].filter(
    (item) => item.closest('[role="menu"]') === menu,
  );
}

async function openMenu(last = false) {
  isOpen.value = true;
  activeSubmenu.value = null;
  await nextTick();
  if (!isOpen.value || !menuElement.value) return;
  const items = menuItems(menuElement.value);
  items[last ? items.length - 1 : 0]?.focus();
}

function toggleMenu() {
  if (isOpen.value) closeMenu();
  else void openMenu();
}

async function openSubmenu(id: SubmenuId) {
  activeSubmenu.value = id;
  await nextTick();
  if (!isOpen.value || activeSubmenu.value !== id) return;
  const submenu = menuElement.value?.querySelector<MenuElement>(`#brand-menu-${id}`);
  if (submenu) menuItems(submenu)[0]?.focus();
}

function closeSubmenu() {
  const id = activeSubmenu.value;
  activeSubmenu.value = null;
  menuElement.value?.querySelector<MenuButton>(`[aria-controls="brand-menu-${id}"]`)?.focus();
}

async function select(action: AppMenuAction) {
  if (isDisabled(action)) return;
  closeMenu();
  await nextTick();
  brandButton.value?.focus();
  emit("select", action);
}

function onMenuKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (!(event.target instanceof globalThis.Element)) return;
  const button = event.target.closest<MenuButton>('button[role="menuitem"]');
  const menu = button?.closest<MenuElement>('[role="menu"]');
  if (!button || !menu) return;

  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const items = menuItems(menu);
    const index = items.indexOf(button);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  } else if (event.key === "ArrowRight" && menu === menuElement.value) {
    const group = groups.find(({ id }) => id === button.dataset.submenu);
    if (!group) return;
    event.preventDefault();
    void openSubmenu(group.id);
  } else if ((event.key === "ArrowLeft" || event.key === "Escape") && menu !== menuElement.value) {
    event.preventDefault();
    closeSubmenu();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === "Tab") {
    closeMenu();
  }
}

function onOutsidePointer(event: InstanceType<typeof globalThis.PointerEvent>) {
  if (event.target instanceof globalThis.Node && container.value?.contains(event.target)) return;
  closeMenu();
}

function onEscape(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key !== "Escape" || !isOpen.value) return;
  event.preventDefault();
  closeMenu(true);
}

function onFocusOut(event: InstanceType<typeof globalThis.FocusEvent>) {
  if (
    event.relatedTarget instanceof globalThis.Node &&
    !container.value?.contains(event.relatedTarget)
  ) {
    closeMenu();
  }
}

onMounted(() => {
  globalThis.document.addEventListener("pointerdown", onOutsidePointer);
  globalThis.document.addEventListener("keydown", onEscape);
});
onUnmounted(() => {
  globalThis.document.removeEventListener("pointerdown", onOutsidePointer);
  globalThis.document.removeEventListener("keydown", onEscape);
});
</script>

<template>
  <div ref="container" class="relative" @focusout="onFocusOut" @mousedown.stop>
    <button
      ref="brandButton"
      aria-controls="brand-menu"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      class="focus-visible:outline-app-accent rounded text-base font-bold whitespace-nowrap focus-visible:outline-2 sm:text-lg"
      type="button"
      @click.stop="toggleMenu"
      @keydown.down.prevent="openMenu()"
      @keydown.up.prevent="openMenu(true)"
    >
      NewBee
    </button>
    <div
      v-if="isOpen"
      id="brand-menu"
      ref="menuElement"
      class="bg-app-interactive absolute top-full left-0 z-50 mt-2 w-44 rounded-lg p-1 shadow-xl ring-1 ring-white/10"
      role="menu"
      :aria-label="t('NewBee 菜单')"
      @keydown.stop="onMenuKeydown"
    >
      <div
        v-for="group in groups"
        :key="group.id"
        class="relative"
        @mouseenter="activeSubmenu = group.id"
      >
        <button
          :id="`brand-menu-${group.id}-trigger`"
          :data-submenu="group.id"
          :aria-controls="`brand-menu-${group.id}`"
          :aria-expanded="activeSubmenu === group.id"
          aria-haspopup="menu"
          class="focus-visible:outline-app-accent flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 focus-visible:outline-2"
          :class="{ 'bg-white/10': activeSubmenu === group.id }"
          role="menuitem"
          tabindex="-1"
          type="button"
          @focus="activeSubmenu = null"
          @click="openSubmenu(group.id)"
        >
          {{ t(group.label) }}
          <ChevronRight aria-hidden="true" class="text-app-muted size-4" />
        </button>
        <div
          v-if="activeSubmenu === group.id"
          :id="`brand-menu-${group.id}`"
          :aria-labelledby="`brand-menu-${group.id}-trigger`"
          class="absolute top-0 left-full w-56 pl-1"
          role="menu"
        >
          <div class="bg-app-interactive rounded-lg p-1 shadow-xl ring-1 ring-white/10">
            <button
              v-for="item in group.items"
              :key="item.action"
              class="focus-visible:outline-app-accent flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isDisabled(item.action)"
              role="menuitem"
              tabindex="-1"
              type="button"
              @click="select(item.action)"
            >
              <span>{{
                item.action === "import" && isImporting ? t("正在导入…") : t(item.label)
              }}</span>
              <kbd class="text-app-muted text-xs whitespace-nowrap">{{
                item.action === "shortcuts" && bindings
                  ? formatShortcut(bindings.showShortcuts.shortcut)
                  : ""
              }}</kbd>
            </button>
          </div>
        </div>
      </div>
      <div class="my-1 border-t border-white/10" role="separator" />
      <button
        v-for="command in commands"
        :key="command.action"
        class="focus-visible:outline-app-accent flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        tabindex="-1"
        type="button"
        @mouseenter="activeSubmenu = null"
        @focus="activeSubmenu = null"
        @click="select(command.action)"
      >
        <span>{{ t(command.label) }}</span>
        <kbd class="text-app-muted text-xs whitespace-nowrap">{{
          bindings ? formatShortcut(bindings[command.binding].shortcut) : ""
        }}</kbd>
      </button>
    </div>
  </div>
</template>
