export type SystemMediaCommand = "play" | "pause" | "previous" | "next";

type SystemMediaActions = {
  isCommandPending: () => boolean;
  isPlaying: () => boolean;
  canPlayPrevious: () => boolean;
  canPlayNext: () => boolean;
  refreshStatus: () => Promise<boolean>;
  togglePlayback: () => Promise<boolean>;
  playPrevious: () => Promise<boolean>;
  playNext: () => Promise<boolean>;
};

export function createSystemMediaCommandHandler(actions: SystemMediaActions) {
  let isHandlingCommand = false;

  return async (command: SystemMediaCommand) => {
    if (isHandlingCommand || actions.isCommandPending()) return;
    isHandlingCommand = true;
    try {
      switch (command) {
        case "previous":
          if (actions.canPlayPrevious()) await actions.playPrevious();
          break;
        case "next":
          if (actions.canPlayNext()) await actions.playNext();
          break;
        case "play":
        case "pause":
          if (!(await actions.refreshStatus()) || actions.isCommandPending()) return;
          // Play/Pause requests are explicit, not toggles. Ignore duplicate requests.
          if (actions.isPlaying() !== (command === "play")) await actions.togglePlayback();
          break;
        default:
          throw new Error(`Unsupported system media command: ${String(command)}`);
      }
    } finally {
      isHandlingCommand = false;
    }
  };
}
