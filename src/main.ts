import { createApp } from "vue";
import App from "@/app/App.vue";
import "@/app/styles/main.css";
import { showMainWindow } from "@/app/startup";
import { installErrorLogging } from "@/app/logging";

globalThis.document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

const app = createApp(App);
installErrorLogging(app);
app.mount("#app");

void showMainWindow();
