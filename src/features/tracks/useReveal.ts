import { ref } from "vue";
import { createTracksApi } from "@/features/tracks/api";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

const pending = ref(false);
const api = createTracksApi();

export function useTrackReveal() {
  async function reveal(trackId?: number | null, path?: string | null) {
    if (pending.value) return;
    pending.value = true;
    try {
      await api.revealFile(trackId, path);
    } catch (error) {
      logger.error("tracks", "reveal_failed", error, { trackId });
      notify({
        type: "error",
        message: error === "file_not_found" ? t("文件不存在") : t("无法在文件资源管理器中显示"),
      });
    } finally {
      pending.value = false;
    }
  }
  return { pending, reveal };
}
