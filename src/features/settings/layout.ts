import { readonly, ref } from "vue";
import type { Settings } from "@/features/settings/types";

const density = ref<Settings["layoutDensity"]>("regular");
export const layoutDensity = readonly(density);

export function applyLayoutDensity(value: Settings["layoutDensity"]) {
  globalThis.document.documentElement.dataset.layoutDensity = value;
  density.value = value;
}
