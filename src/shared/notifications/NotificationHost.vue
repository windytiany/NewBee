<template>
  <Teleport :to="target">
    <section
      ref="host"
      :aria-label="t('通知')"
      class="pointer-events-none fixed right-4 bottom-24 z-100 flex max-h-[calc(100dvh-8rem)] w-[min(28rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto"
      @click.stop
      @mousedown.stop
    >
      <article
        v-for="item in notifications.visible.value"
        :key="item.id"
        :data-notification-id="item.id"
        class="bg-app-interactive pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-xl ring-1 ring-white/15"
        :class="tone[item.type]"
        @mouseenter="notifications.pause(item.id, 'hover', true)"
        @mouseleave="notifications.pause(item.id, 'hover', false)"
        @focusin="notifications.pause(item.id, 'focus', true)"
        @focusout="onFocusOut(item.id, $event)"
      >
        <component :is="icon[item.type]" aria-hidden="true" class="mt-0.5 size-5 shrink-0" />
        <p
          class="min-w-0 flex-1 wrap-anywhere whitespace-pre-wrap"
          :role="item.type === 'error' || item.type === 'warning' ? 'alert' : 'status'"
          aria-atomic="true"
        >
          {{ item.message
          }}<span v-if="item.count > 1" class="ml-2 text-white/60">×{{ item.count }}</span>
        </p>
        <button
          v-if="item.action"
          type="button"
          class="focus-visible:outline-app-accent shrink-0 rounded px-2 py-1 hover:bg-white/10 focus-visible:outline-2"
          @click="
            item.action.run();
            dismiss(item.id);
          "
        >
          {{ item.action.label }}
        </button>
        <button
          :aria-label="t('关闭通知')"
          class="focus-visible:outline-app-accent -mr-1 shrink-0 rounded p-1 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2"
          type="button"
          @click="dismiss(item.id)"
        >
          <X aria-hidden="true" class="size-4" />
        </button>
      </article>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, shallowRef } from "vue";
import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from "@lucide/vue";
import { notifications } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

const tone = {
  success: "text-green-200",
  info: "text-white",
  warning: "text-amber-200",
  error: "text-red-200",
};
const icon = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleAlert };
type Element = InstanceType<typeof globalThis.HTMLElement>;
const target = shallowRef<string | Element>("body");
const host = shallowRef<Element | null>(null);
let observer: InstanceType<typeof globalThis.MutationObserver> | null = null;
let previousFocus: Element | null = null;

function updateTarget() {
  // Native modal dialogs make the rest of the document inert, regardless of z-index.
  const dialogs =
    globalThis.document.querySelectorAll<InstanceType<typeof globalThis.HTMLDialogElement>>(
      "dialog[open]",
    );
  target.value = dialogs.item(dialogs.length - 1) ?? "body";
}

function rememberFocus(event: InstanceType<typeof globalThis.FocusEvent>) {
  if (event.target instanceof globalThis.HTMLElement && !host.value?.contains(event.target)) {
    previousFocus = event.target;
  }
}

function onFocusOut(id: number, event: InstanceType<typeof globalThis.FocusEvent>) {
  if (
    event.relatedTarget instanceof globalThis.Node &&
    event.currentTarget instanceof globalThis.Node &&
    event.currentTarget.contains(event.relatedTarget)
  )
    return;
  notifications.pause(id, "focus", false);
}

async function dismiss(id: number) {
  const restoreFocus = host.value?.contains(globalThis.document.activeElement) ?? false;
  notifications.dismiss(id);
  if (!restoreFocus) return;
  await nextTick();
  const nextButton =
    host.value?.querySelector<InstanceType<typeof globalThis.HTMLButtonElement>>("button");
  if (nextButton) nextButton.focus({ preventScroll: true });
  else if (
    previousFocus?.isConnected &&
    (typeof target.value === "string" || target.value.contains(previousFocus))
  ) {
    previousFocus.focus({ preventScroll: true });
  } else if (typeof target.value !== "string") {
    target.value.focus({ preventScroll: true });
  }
}

onMounted(() => {
  updateTarget();
  observer = new globalThis.MutationObserver(updateTarget);
  observer.observe(globalThis.document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  globalThis.document.addEventListener("focusin", rememberFocus);
});

onUnmounted(() => {
  observer?.disconnect();
  globalThis.document.removeEventListener("focusin", rememberFocus);
  notifications.clear();
});
</script>
