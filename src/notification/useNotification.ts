import { watch } from "vue";
import { notify } from "@/notification/center";
import type { NotificationInput } from "@/notification/center";

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
