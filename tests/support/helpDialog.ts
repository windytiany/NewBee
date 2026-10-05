import { Info, X } from "@lucide/vue";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "./moduleLoader";

const source = await Bun.file(
  new URL("../../src/shared/components/HelpDialog.vue", import.meta.url),
).text();
export const HelpDialog = evaluateModule<{ default: Vue.Component }>(
  compileSfc(source, "src/shared/components/HelpDialog.vue"),
  { vue: Vue, "@lucide/vue": { Info, X } },
).default;
