import { createApp } from "vue";
import App from "@/app/App.vue";
import "@/app/styles/main.css";
import { showMainWindow } from "@/app/startup";

globalThis.document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

createApp(App).mount("#app");

void showMainWindow();
