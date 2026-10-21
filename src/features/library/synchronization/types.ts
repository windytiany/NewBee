export type SynchronizationFolder = {
  path: string;
  enabled: boolean;
  mode: "manual" | "startup" | "continuous";
};

export type SynchronizationSnapshot = {
  progress?: { path: string; completed: number; total: number } | null;
  statuses: {
    path: string;
    phase: "scanning" | "watching" | "idle" | "unavailable" | "error" | "warning";
    error: string | null;
    issues?: { failed: number; replayGainFailed: number } | null;
  }[];
  missing: string[];
};
