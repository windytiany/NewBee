import { Info, X } from "@lucide/vue";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../module/loader";

const source = await Bun.file(
  new URL("../../../src/shared/help/HelpDialog.vue", import.meta.url),
).text();
export const HelpDialog = evaluateModule<{ default: Vue.Component }>(
  compileSfc(source, "src/shared/help/HelpDialog.vue"),
  { vue: Vue, "@lucide/vue": { Info, X } },
).default;
