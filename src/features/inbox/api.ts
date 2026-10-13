import { invoke } from "@tauri-apps/api/core";

import type { TrackDetails } from "@/features/tracks/types";
export type InboxTrack = Omit<TrackDetails, "id"> & { id: string; addedAt: number };
export type InboxResult = {
  path: string;
  success: boolean;
  skipped?: boolean;
  error: string | null;
};
export type InboxRead = { tracks: InboxTrack[]; failures: InboxResult[] };
export function createInboxApi(invokeCommand: typeof invoke = invoke) {
  return {
    read: () => invokeCommand<InboxRead>("read_inbox"),
    register: (paths: string[], directory: boolean) =>
      invokeCommand<InboxResult[]>("register_inbox", { paths, directory }),
    remove: (paths: string[]) => invokeCommand<void>("remove_inbox", { paths }),
    ingest: (paths: string[]) => invokeCommand<InboxResult[]>("ingest_inbox", { paths }),
  };
}
export const INBOX_CHANGED_EVENT = "newbee:inbox-changed";
