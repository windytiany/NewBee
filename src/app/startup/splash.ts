import { invoke } from "@tauri-apps/api/core";
import icon from "../../../src-tauri/icons/128x128@2x.png";
import "./splash.css";

type Snapshot = {
  phase: "loading" | "timeout" | "failed" | "quitting" | "complete";
  splashEnabled: boolean;
  locale: "zh-CN" | "en";
  themeMode: "system" | "light" | "dark";
};

const image = document.querySelector<HTMLImageElement>("#icon")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const actions = document.querySelector<HTMLDivElement>("#actions")!;
const continueButton = document.querySelector<HTMLButtonElement>("#continue")!;
const exitButton = document.querySelector<HTMLButtonElement>("#exit")!;
image.src = icon;
const imageReady = image.decode().catch(() => {});
let stopped = false;
let busy = false;

async function perform(command: string) {
  if (busy) return;
  busy = true;
  continueButton.disabled = true;
  exitButton.disabled = true;
  try {
    await invoke(command);
  } finally {
    busy = false;
    continueButton.disabled = false;
    exitButton.disabled = false;
  }
}

continueButton.addEventListener("click", () => {
  void perform("continue_startup").catch(console.error);
});
exitButton.addEventListener("click", () => {
  void perform("exit_startup").catch(console.error);
});
window.addEventListener("pagehide", () => {
  stopped = true;
});
document.addEventListener("contextmenu", (event) => event.preventDefault());

async function poll() {
  try {
    const snapshot = await invoke<Snapshot>("startup_status");
    if (snapshot.phase === "complete") return;
    document.documentElement.lang = snapshot.locale;
    document.documentElement.dataset.themeMode = snapshot.themeMode;
    document.body.dataset.phase = snapshot.phase;
    const en = snapshot.locale === "en";
    status.textContent =
      snapshot.phase === "failed"
        ? en
          ? "Startup failed"
          : "启动失败"
        : snapshot.phase === "quitting"
          ? en
            ? "Quitting…"
            : "正在退出…"
          : en
            ? "Startup timed out"
            : "启动超时";
    status.hidden = snapshot.phase === "loading";
    actions.hidden = snapshot.phase === "loading" || snapshot.phase === "quitting";
    continueButton.hidden = snapshot.phase !== "timeout";
    continueButton.textContent = en ? "Keep waiting" : "继续等待";
    exitButton.textContent = en ? "Quit" : "退出";
    await imageReady;
    // Do not depend on animation frames here: hidden/occluded WebViews can
    // throttle them, but timeout and failure controls must remain available.
    await invoke("present_splash");
  } catch (error) {
    if (!stopped) console.error(error);
  }
  if (!stopped)
    setTimeout(() => {
      void poll();
    }, 250);
}

void poll();
