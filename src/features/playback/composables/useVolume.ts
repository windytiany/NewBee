import { computed, ref } from "vue";
import { usePlaybackSession } from "@/features/playback/session";

export function usePlaybackVolume() {
  const session = usePlaybackSession();
  const draft = ref<number | null>(null);
  let requestVersion = 0;
  const volume = computed({
    get: () => draft.value ?? session.state.volume.value,
    set: (value: number) => {
      draft.value = value;
      const version = ++requestVersion;
      void session.setVolume(value).finally(() => {
        if (version === requestVersion) draft.value = null;
      });
    },
  });

  return {
    volume,
    volumeError: session.state.playbackError,
    toggleMute: session.toggleMute,
  };
}
