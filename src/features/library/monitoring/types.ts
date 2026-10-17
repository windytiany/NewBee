export type MonitoringFolder = {
  path: string;
  enabled: boolean;
  mode: "startup" | "continuous";
};

export type MonitoringSnapshot = {
  statuses: {
    path: string;
    phase: "scanning" | "watching" | "idle" | "unavailable" | "error";
    error: string | null;
  }[];
  missing: string[];
};
