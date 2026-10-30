import { computed, readonly, ref } from "vue";
import type { CheckOptions, DownloadEvent, Update } from "@tauri-apps/plugin-updater";

type UpdateResource = Pick<Update, "version" | "download" | "install" | "close">;
type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "installing";
type Dependencies = {
  supported: boolean;
  check: (options: CheckOptions) => Promise<UpdateResource | null>;
  failed: (event: string, error: unknown) => void;
};

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;

export function createUpdater(dependencies: Dependencies) {
  const phase = ref<Phase>("idle");
  const version = ref("");
  const dialogOpen = ref(false);
  const error = ref("");
  const downloaded = ref(0);
  const total = ref<number>();
  let resource: UpdateResource | null = null;
  let checking: Promise<void> | undefined;
  const busy = computed(() => ["checking", "downloading", "installing"].includes(phase.value));
  // Downloaded bytes belong to this WebView. Keep them alive until installation.
  const holdsWindow = computed(() => busy.value || phase.value === "ready");

  async function release() {
    const previous = resource;
    resource = null;
    if (!previous) return;
    try {
      await previous.close();
    } catch (reason) {
      dependencies.failed("resource_release_failed", reason);
    }
  }

  async function performCheck() {
    phase.value = "checking";
    error.value = "";
    version.value = "";
    await release();
    try {
      resource = await dependencies.check({ timeout: CHECK_TIMEOUT_MS });
      version.value = resource?.version ?? "";
      phase.value = resource ? "available" : "latest";
      dialogOpen.value = resource !== null;
    } catch (reason) {
      dependencies.failed("check_failed", reason);
      error.value = "检查更新失败，请稍后重试";
      phase.value = "idle";
    }
  }

  function check() {
    if (!dependencies.supported) return Promise.resolve();
    if (checking) return checking;
    if (phase.value === "ready") {
      dialogOpen.value = true;
      return Promise.resolve();
    }
    if (busy.value) return Promise.resolve();
    checking = performCheck().finally(() => {
      checking = undefined;
    });
    return checking;
  }

  function progress(event: DownloadEvent) {
    if (event.event === "Started") {
      downloaded.value = 0;
      total.value = event.data.contentLength || undefined;
    } else if (event.event === "Progress") {
      downloaded.value += event.data.chunkLength;
    }
  }

  async function download() {
    if (phase.value !== "available" || !resource) return;
    phase.value = "downloading";
    error.value = "";
    downloaded.value = 0;
    total.value = undefined;
    try {
      await resource.download(progress, { timeout: DOWNLOAD_TIMEOUT_MS });
      // Finished only means the network transfer ended. Await signature verification too.
      phase.value = "ready";
    } catch (reason) {
      dependencies.failed("download_failed", reason);
      error.value = "下载或验证更新失败，请重试";
      phase.value = "available";
    }
  }

  async function install() {
    if (phase.value !== "ready" || !resource) return;
    phase.value = "installing";
    error.value = "";
    try {
      // On Windows the installer exits this process and relaunches the updated app.
      await resource.install({ restartAfterInstall: true });
    } catch (reason) {
      dependencies.failed("install_failed", reason);
      error.value = "安装更新失败，请重试";
      phase.value = "ready";
    }
  }

  async function update() {
    if (phase.value === "available") await download();
    if (phase.value === "ready") await install();
  }

  function dismiss() {
    if (!busy.value) dialogOpen.value = false;
  }

  return {
    dialogOpen: readonly(dialogOpen),
    dismiss,
    update,
    supported: dependencies.supported,
    phase: readonly(phase),
    version: readonly(version),
    error: readonly(error),
    downloaded: readonly(downloaded),
    total: readonly(total),
    busy,
    holdsWindow,
    check,
    download,
    install,
  };
}
