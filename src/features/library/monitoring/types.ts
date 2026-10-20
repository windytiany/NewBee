export type MonitoringFolder = {
  path: string;
  enabled: boolean;
  mode: "startup" | "continuous";
};

export type MonitoringSnapshot = {
  progress?: { path: string; completed: number; total: number } | null;
  statuses: {
    path: string;
    phase: "scanning" | "watching" | "idle" | "unavailable" | "error";
    error: string | null;
  }[];
  missing: string[];
};
