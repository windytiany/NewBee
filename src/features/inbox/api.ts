import type { invoke } from "@tauri-apps/api/core";
import { taskInvoke } from "@/features/tasks/commands";

import type { TrackDetails } from "@/features/tracks/types";
export type InboxTrack = TrackDetails & { addedAt: number };
export type InboxResult = {
  trackId: number | null;
  path: string;
  success: boolean;
  skipped: boolean;
  error: string | null;
};
export type InboxRead = { tracks: InboxTrack[]; failures: InboxResult[] };
export function createInboxApi(invokeCommand: typeof invoke = taskInvoke) {
  return {
    read: () => invokeCommand<InboxRead>("read_inbox"),
    register: (paths: string[], directory: boolean) =>
      invokeCommand<InboxResult[]>("register_inbox", { paths, directory }),
    remove: (trackIds: number[]) => invokeCommand<void>("remove_inbox", { trackIds }),
    ingest: (trackIds: number[]) => invokeCommand<InboxResult[]>("ingest_inbox", { trackIds }),
  };
}
export const INBOX_CHANGED_EVENT = "newbee:inbox-changed";
