import { reactive, toRefs } from "vue";
import type { EditableTrack } from "@/features/metadata/types";
import type { createMetadataSave } from "@/features/metadata/save";
import type {
  AlbumField,
  CoverChoice,
  CoverData,
  MatchRow,
  ReleaseDetails,
  ReleaseSummary,
  TrackPatch,
} from "@/features/metadata/releases/types";

export function createReleaseState(saving: ReturnType<typeof createMetadataSave>) {
  return reactive({
    ...toRefs(saving.state),
    open: false,
    loading: false,
    searching: false,
    hasSearched: false,
    loadingRelease: false,
    loadingCover: false,
    dirty: false,
    coverError: "",
    artist: "",
    album: "",
    directId: "",
    tracks: [] as EditableTrack[],
    candidates: [] as ReleaseSummary[],
    count: 0,
    offset: 0,
    selected: null as ReleaseDetails | null,
    rows: [] as MatchRow[],
    fields: [] as AlbumField[],
    included: [] as number[],
    covers: [] as CoverChoice[],
    coverId: "",
    cover: null as CoverData | null,
    writeCover: false,
    confirmDiscard: false,
    confirmSave: false,
    writeBlocked: false,
    patches: [] as TrackPatch[],
  });
}

export type ReleaseEditorState = ReturnType<typeof createReleaseState>;
export type ReleaseErrorReporter = (event: string, error: unknown, cover?: boolean) => void;
