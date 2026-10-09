import { nextTick } from "vue";
import type { TrackArtwork } from "@/features/artwork/types";

export type DecodedArtwork = {
  readonly url: string;
  readonly content: TrackArtwork;
  readonly decoder: HTMLImageElement;
  retain(): () => void;
};

export type ArtworkResourceSnapshot = {
  status: "loading" | "ready" | "fallback";
  image: DecodedArtwork | null;
  error: string;
};

export type ArtworkResource = {
  readonly snapshot: ArtworkResourceSnapshot;
  subscribe(
    subscriber: (snapshot: ArtworkResourceSnapshot) => void,
  ): (afterRender?: boolean) => void;
  reload(): void;
};

/** Owns one active subscription group's decoding and URL lifetime, not its cache key. */
export function createArtworkResource(
  load: () => Promise<TrackArtwork>,
  reportError: (error: unknown) => string,
  schedule: (run: () => Promise<void>, isCurrent: () => boolean) => void = (run) => {
    void run();
  },
): ArtworkResource {
  let snapshot: ArtworkResourceSnapshot = { status: "loading", image: null, error: "" };
  const subscribers = new Set<(snapshot: ArtworkResourceSnapshot) => void>();
  let generation = 0;
  let started = false;
  let disposeImage: ((afterRender: boolean) => void) | null = null;

  function publish(next: ArtworkResourceSnapshot) {
    snapshot = next;
    for (const subscriber of [...subscribers]) {
      if (subscribers.has(subscriber)) subscriber(snapshot);
    }
  }

  function clearImage(afterRender = true) {
    disposeImage?.(afterRender);
    disposeImage = null;
  }

  function reload() {
    const currentGeneration = ++generation;
    const isCurrent = () => generation === currentGeneration && subscribers.size > 0;
    clearImage();
    publish({ status: "loading", image: null, error: "" });
    schedule(async () => {
      if (!isCurrent()) return;
      try {
        const content = await load();
        if (!isCurrent()) return;
        if (content.byteLength === 0) {
          publish({ status: "fallback", image: null, error: "" });
          return;
        }
        const decoder = new globalThis.Image();
        const url = globalThis.URL.createObjectURL(new globalThis.Blob([content]));
        let retained = 0;
        let retired = false;
        let revocable = false;
        let revoked = false;
        function revoke() {
          if (!revocable || retained > 0 || revoked) return;
          revoked = true;
          globalThis.URL.revokeObjectURL(url);
        }
        disposeImage = (afterRender) => {
          if (retired) return;
          retired = true;
          decoder.removeAttribute("src");
          const release = () => {
            revocable = true;
            revoke();
          };
          if (afterRender) void nextTick().then(release);
          else release();
        };
        const image: DecodedArtwork = {
          url,
          content,
          decoder,
          retain() {
            if (revoked) return () => {};
            retained++;
            let released = false;
            return () => {
              if (released) return;
              released = true;
              retained--;
              revoke();
            };
          },
        };
        decoder.src = url;
        await decoder.decode();
        if (isCurrent()) publish({ status: "ready", image, error: "" });
      } catch (error) {
        if (!isCurrent()) return;
        clearImage(false);
        publish({ status: "fallback", image: null, error: reportError(error) });
      }
    }, isCurrent);
  }

  return {
    get snapshot() {
      return snapshot;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      if (!started) {
        started = true;
        void reload();
      } else subscriber(snapshot);
      return (afterRender = true) => {
        if (!subscribers.delete(subscriber) || subscribers.size > 0) return;
        ++generation;
        clearImage(afterRender);
        snapshot = { status: "fallback", image: null, error: "" };
        started = false;
      };
    },
    reload() {
      if (subscribers.size > 0) void reload();
    },
  };
}
