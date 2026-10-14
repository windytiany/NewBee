import { afterEach, describe, expect, it } from "bun:test";
import { effectScope, nextTick, ref } from "vue";
import { usePresentation } from "@/features/tracks/presentation/usePresentation";
import type { TrackPresentation } from "@/features/tracks/types";

const scopes: Array<ReturnType<typeof effectScope>> = [];
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

async function settle() {
  await Promise.resolve();
  await nextTick();
}

function fixture() {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const requests: Array<{
    id: number;
    resolve: (track: TrackPresentation | null) => void;
    reject: (error: unknown) => void;
  }> = [];
  const id = ref<number | null>(1);
  const scope = effectScope();
  scopes.push(scope);
  const presentation = scope.run(() =>
    usePresentation(
      id,
      (_command, { trackId }) =>
        new Promise<TrackPresentation | null>((resolve, reject) => {
          requests.push({ id: trackId, resolve, reject });
        }),
    ),
  );
  if (!presentation) throw new Error("Missing presentation");
  return { id, presentation, requests };
}

const track: TrackPresentation = {
  title: "Metadata title",
  album: "Metadata album",
  durationMs: 125000,
};

describe("queue metadata confirmation", () => {
  it("keeps all fields loading while reading and awaiting metadata confirmation", async () => {
    const { presentation, requests } = fixture();
    expect(presentation.value).toEqual({ status: "loading" });
    requests[0]!.resolve(null);
    await settle();
    expect(presentation.value).toEqual({ status: "loading" });
  });

  it.each([track, { title: "filename", album: null, durationMs: null }])(
    "publishes all confirmed fields together: %j",
    async (value) => {
      const { presentation, requests } = fixture();
      requests[0]!.resolve(value);
      await settle();
      expect(presentation.value).toEqual({ status: "ready", track: value });
    },
  );

  it("allows fallback only after a request fails", async () => {
    const { presentation, requests } = fixture();
    expect(presentation.value.status).toBe("loading");
    requests[0]!.reject(new Error("Read failed"));
    await settle();
    expect(presentation.value.status).toBe("failed");
  });

  it("reloads after confirmation and ignores unrelated changes", async () => {
    const { presentation, requests } = fixture();
    requests[0]!.resolve(null);
    await settle();
    globalThis.window.dispatchEvent(
      new CustomEvent("newbee:tracks-changed", { detail: { trackIds: [2] } }),
    );
    expect(requests).toHaveLength(1);
    globalThis.window.dispatchEvent(
      new CustomEvent("newbee:tracks-changed", { detail: { trackIds: [1] } }),
    );
    expect(requests).toHaveLength(2);
    expect(presentation.value.status).toBe("loading");
    requests[1]!.resolve(track);
    await settle();
    expect(presentation.value).toEqual({ status: "ready", track });
  });

  it("ignores late results from the previous track", async () => {
    const { id, presentation, requests } = fixture();
    id.value = 2;
    requests[0]!.resolve(track);
    await settle();
    expect(presentation.value.status).toBe("loading");
    const current = { ...track, title: "Current title" };
    requests[1]!.resolve(current);
    await settle();
    expect(presentation.value).toEqual({ status: "ready", track: current });
  });
});
