import { watch } from "vue";
import { notify } from "@/shared/notifications/center";
import type { NotificationInput } from "@/shared/notifications/center";

/** Observe business outcomes, without changing or dismissing their underlying state. */
export function useNotification(source: () => NotificationInput | null) {
  watch(
    source,
    (input) => {
      if (input) notify(input);
    },
    { immediate: true },
  );
}
