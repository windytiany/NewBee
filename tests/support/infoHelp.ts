import { Info, X } from "@lucide/vue";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "./moduleLoader";

const source = await Bun.file(new URL("../../src/ui/InfoHelp.vue", import.meta.url)).text();
export const InfoHelp = evaluateModule<{ default: Vue.Component }>(
  compileSfc(source, "src/ui/InfoHelp.vue"),
  { vue: Vue, "@lucide/vue": { Info, X } },
).default;
