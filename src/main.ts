import { createApp } from "vue";
import App from "@/App.vue";
import "@/style.css";

globalThis.document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

createApp(App).mount("#app");
