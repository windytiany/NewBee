import type { PlaybackQueuePersistenceSnapshot } from "@/playback/queue/persistence";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

export type PlaybackStartFailure = {
  kind: "audio-file-not-found" | "playback-failed";
  message: string;
};

export type QueuePlaybackAttempt =
  | { status: "started"; playbackId: number }
  | { status: "failed"; failure: PlaybackStartFailure }
  | { status: "cancelled" };

export type PlaybackQueueSnapshot = {
  displayedTracks: readonly PlaybackDisplayTrack[];
  currentRowKey: string | null;
  queuePlaybackError: string;
  repeatOneEnabled: boolean;
  shuffleEnabled: boolean;
  canPlayPrevious: boolean;
  canPlayNext: boolean;
};

type AttemptPlayback = (
  trackId: number,
  canStart: () => boolean,
  rowKey: string,
) => Promise<QueuePlaybackAttempt>;
type StopPlayback = (playbackId: number) => Promise<boolean>;
type StopStalePlayback = (playbackId: number) => Promise<void>;
type PlaybackQueueCoordinatorOptions = {
  random?: () => number;
  stopPlayback?: StopPlayback;
  stopStalePlayback?: StopStalePlayback;
  finishPlayback?: (playbackId: number, canFinish: () => boolean) => Promise<void>;
};
type ItemPlaybackResult = "started" | "failed" | "cancelled";
type PlaybackHistoryAction =
  { kind: "append" } | { kind: "move"; index: number } | { kind: "none" };
type PlayItemOptions = {
  replaceQueue: boolean;
  repeatRestart?: boolean;
  historyAction?: PlaybackHistoryAction;
};
type NextCandidateOptions = { stopWhenExhausted?: boolean };
type QueueTrack = PlaybackDisplayTrack & { isNext: boolean };
type NewQueueTrack = Omit<PlaybackDisplayTrack, "rowKey">;
export type QueueTrackRemovalResult =
  | { status: "not-found" }
  | { status: "removed" }
  | { status: "stop-failed"; message: string }
  | { status: "stop-unconfirmed" }
  | { status: "superseded" };
type QueueRemovalResult = {
  result: QueueTrackRemovalResult;
  resumePlaybackId: number | null;
};

export class PlaybackQueueCoordinator {
  private displayedTracks: QueueTrack[] = [];
  private currentRowKey: string | null = null;
  private failures: string[] = [];
  private repeatOneEnabled = false;
  private shuffleEnabled = false;
  private roundTracks: QueueTrack[] = [];
  private remainingCandidates: QueueTrack[] = [];
  private playbackHistory: string[] = [];
  private historyIndex = -1;
  private activePlaybackId: number | null = null;
  private handledEndPlaybackId: number | null = null;
  private ignoredEndPlaybackId: number | null = null;
  private operationGeneration = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private readonly random: () => number;
  private readonly stopPlayback: StopPlayback;
  private readonly stopStalePlayback: StopStalePlayback;
  private readonly finishPlayback: NonNullable<PlaybackQueueCoordinatorOptions["finishPlayback"]>;

  constructor(
    private readonly attemptPlayback: AttemptPlayback,
    private readonly onStateChange: (
      snapshot: PlaybackQueueSnapshot,
      persistenceSnapshot: PlaybackQueuePersistenceSnapshot,
    ) => void,
    options: PlaybackQueueCoordinatorOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.stopPlayback = options.stopPlayback ?? (async () => true);
    this.stopStalePlayback = options.stopStalePlayback ?? (async () => {});
    this.finishPlayback = options.finishPlayback ?? (async () => {});
  }

  get snapshot(): PlaybackQueueSnapshot {
    return {
      displayedTracks: this.displayedTracks.map(toPlaybackDisplayTrack),
      currentRowKey: this.currentRowKey,
      queuePlaybackError: this.failures.join("\n"),
      repeatOneEnabled: this.repeatOneEnabled,
      shuffleEnabled: this.shuffleEnabled,
      canPlayPrevious: this.shuffleEnabled ? this.historyIndex > 0 : this.currentQueueIndex() > 0,
      canPlayNext: this.hasNextTarget(),
    };
  }

  restoreQueue(snapshot: PlaybackQueuePersistenceSnapshot) {
    this.operationGeneration += 1;
    const nextRowKeys = new Set(snapshot.nextRowKeys);
    this.displayedTracks = snapshot.displayedTracks.map((track) => ({
      ...track,
      isNext: nextRowKeys.has(track.rowKey),
    }));
    this.currentRowKey = snapshot.currentRowKey;
    this.failures = [];
    this.repeatOneEnabled = snapshot.repeatOneEnabled;
    this.shuffleEnabled = snapshot.shuffleEnabled;
    this.roundTracks = this.displayedTracks.map((track) => ({ ...track }));

    const currentIndex =
      snapshot.currentRowKey === null
        ? -1
        : this.roundTracks.findIndex((track) => track.rowKey === snapshot.currentRowKey);
    this.remainingCandidates = this.orderCandidates(this.roundTracks.slice(currentIndex + 1));
    this.playbackHistory = [];
    this.historyIndex = -1;
    this.activePlaybackId = null;
    this.handledEndPlaybackId = null;
    this.ignoredEndPlaybackId = null;
    this.publish();
  }

  replaceAndPlay(items: readonly PlaybackDisplayTrack[], startRowKey: string): Promise<boolean> {
    const queue = items.map((item) => ({ ...item, isNext: false }));
    const startIndex = queue.findIndex((item) => item.rowKey === startRowKey);
    if (startIndex < 0) return Promise.resolve(false);

    const generation = this.beginUserOperation();
    return this.enqueue(() => {
      if (!this.isCurrentOperation(generation)) return Promise.resolve(false);
      this.supersedeCurrentPlayback();
      return this.playRound(queue, startIndex, generation, true);
    });
  }

  playQueueItem(rowKey: string): Promise<boolean> {
    const generation = this.beginUserOperation();
    return this.enqueue(() => {
      if (!this.isCurrentOperation(generation)) return Promise.resolve(false);

      const startIndex = this.displayedTracks.findIndex((item) => item.rowKey === rowKey);
      if (startIndex < 0) return Promise.resolve(false);
      this.supersedeCurrentPlayback();
      return this.playRound(this.displayedTracks, startIndex, generation, false);
    });
  }

  playPrevious(): Promise<boolean> {
    if (!this.snapshot.canPlayPrevious) return Promise.resolve(false);

    const generation = this.beginUserOperation();
    return this.enqueue(() => {
      if (!this.isCurrentOperation(generation)) return Promise.resolve(false);
      return this.shuffleEnabled
        ? this.playPreviousFromHistory(generation)
        : this.playSequential(-1, generation, false);
    });
  }

  playNext(): Promise<boolean> {
    if (!this.hasNextTarget()) return Promise.resolve(false);

    const generation = this.beginUserOperation();
    return this.enqueue(() => {
      if (!this.isCurrentOperation(generation)) return Promise.resolve(false);
      return this.playNextFromHistory(generation, { stopWhenExhausted: true });
    });
  }

  addToNext(track: NewQueueTrack): Promise<boolean> {
    return this.addTracksToNext([track]);
  }

  addTracksToNext(tracks: readonly NewQueueTrack[]): Promise<boolean> {
    if (tracks.length === 0) return Promise.resolve(false);

    return this.enqueue(() => {
      const items = this.createQueueItems(tracks, true);
      this.displayedTracks.splice(this.getNextInsertionIndex(this.displayedTracks), 0, ...items);
      this.roundTracks.splice(
        this.getNextInsertionIndex(this.roundTracks),
        0,
        ...items.map((item) => ({ ...item })),
      );
      const itemRowKeys = items.map((item) => item.rowKey);

      if (
        this.historyIndex >= 0 &&
        this.playbackHistory[this.historyIndex] === this.currentRowKey
      ) {
        this.playbackHistory.splice(this.historyIndex + 1, 0, ...itemRowKeys);
      } else {
        this.remainingCandidates.unshift(...items.map((item) => ({ ...item })));
      }

      this.publish();
      return Promise.resolve(true);
    });
  }

  addToQueueEnd(track: NewQueueTrack): Promise<boolean> {
    return this.addTracksToQueueEnd([track]);
  }

  addTracksToQueueEnd(tracks: readonly NewQueueTrack[]): Promise<boolean> {
    if (tracks.length === 0) return Promise.resolve(false);

    return this.enqueue(() => {
      const items = this.createQueueItems(tracks);
      this.displayedTracks.push(...items);
      this.roundTracks.push(...items.map((item) => ({ ...item })));
      this.remainingCandidates = this.orderCandidates([
        ...this.remainingCandidates,
        ...items.map((item) => ({ ...item })),
      ]);
      this.publish();
      return Promise.resolve(true);
    });
  }

  async removeQueueItems(rowKeys: readonly string[]): Promise<QueueTrackRemovalResult> {
    const selectedRowKeys = new Set(rowKeys);
    if (!this.displayedTracks.some((item) => selectedRowKeys.has(item.rowKey))) {
      return { status: "not-found" };
    }

    const generation = this.beginQueueRemoval();
    const removal = await this.enqueue(() => {
      if (!this.isCurrentOperation(generation)) {
        return Promise.resolve({
          result: { status: "superseded" },
          resumePlaybackId: null,
        } satisfies QueueRemovalResult);
      }
      const selectedItems = this.displayedTracks.filter((item) => selectedRowKeys.has(item.rowKey));
      return this.removeItemsFromQueue(selectedItems, generation);
    });
    return this.finishQueueRemoval(removal, generation);
  }

  async removeTrackFromQueue(trackId: number): Promise<QueueTrackRemovalResult> {
    if (
      !this.displayedTracks.some((item) => item.trackId === trackId) &&
      !this.roundTracks.some((item) => item.trackId === trackId)
    ) {
      return { status: "not-found" };
    }

    const generation = this.beginQueueRemoval();
    const removal = await this.enqueue(() => {
      if (!this.isCurrentOperation(generation)) {
        return Promise.resolve({
          result: { status: "superseded" },
          resumePlaybackId: null,
        } satisfies QueueRemovalResult);
      }
      const matchingItems = new Map<string, PlaybackDisplayTrack>();
      for (const item of [...this.displayedTracks, ...this.roundTracks]) {
        if (item.trackId === trackId) matchingItems.set(item.rowKey, item);
      }
      return this.removeItemsFromQueue([...matchingItems.values()], generation);
    });
    return this.finishQueueRemoval(removal, generation);
  }

  private beginQueueRemoval() {
    this.operationGeneration += 1;
    this.failures = [];
    return this.operationGeneration;
  }

  private async finishQueueRemoval(
    removal: QueueRemovalResult,
    generation: number,
  ): Promise<QueueTrackRemovalResult> {
    if (removal.result.status !== "removed") return removal.result;
    if (!this.isCurrentOperation(generation)) return { status: "superseded" };

    if (removal.resumePlaybackId !== null) {
      await this.scheduleAdvance(removal.resumePlaybackId);
      if (!this.isCurrentOperation(generation)) return { status: "superseded" };
    }
    return removal.result;
  }

  private async removeItemsFromQueue(
    removedItems: readonly PlaybackDisplayTrack[],
    generation: number,
  ): Promise<QueueRemovalResult> {
    if (!this.isCurrentOperation(generation)) {
      return { result: { status: "superseded" }, resumePlaybackId: null };
    }

    const removedRowKeys = new Set(removedItems.map((item) => item.rowKey));
    const removedCurrentItem = removedItems.find((item) => item.rowKey === this.currentRowKey);
    const failureItem = removedCurrentItem ?? removedItems[0];
    if (!failureItem) {
      return { result: { status: "not-found" }, resumePlaybackId: null };
    }

    const endedPlaybackId = this.activePlaybackId;
    const resumePendingAdvance =
      !removedCurrentItem &&
      endedPlaybackId !== null &&
      this.handledEndPlaybackId === endedPlaybackId &&
      this.ignoredEndPlaybackId !== endedPlaybackId;

    this.displayedTracks = this.displayedTracks.filter((item) => !removedRowKeys.has(item.rowKey));
    this.roundTracks = this.roundTracks.filter((item) => !removedRowKeys.has(item.rowKey));
    this.remainingCandidates = this.remainingCandidates.filter(
      (item) => !removedRowKeys.has(item.rowKey),
    );
    this.removeFromPlaybackHistory(removedRowKeys);
    this.failures = [];

    if (removedCurrentItem) {
      this.currentRowKey = null;
      this.activePlaybackId = null;
      this.handledEndPlaybackId = null;
      if (endedPlaybackId !== null) this.ignoredEndPlaybackId = endedPlaybackId;
      this.publish();

      let canAdvance = true;
      if (endedPlaybackId !== null) {
        try {
          canAdvance = await this.stopPlayback(endedPlaybackId);
        } catch (error) {
          if (!this.isCurrentOperation(generation)) {
            return { result: { status: "superseded" }, resumePlaybackId: null };
          }
          this.failures = [formatStopFailure(failureItem, error)];
          this.publish();
          return {
            result: { status: "stop-failed", message: errorMessage(error) },
            resumePlaybackId: null,
          };
        }
      }
      if (!this.isCurrentOperation(generation)) {
        return { result: { status: "superseded" }, resumePlaybackId: null };
      }
      if (!canAdvance) {
        return { result: { status: "stop-unconfirmed" }, resumePlaybackId: null };
      }

      await this.playNextFromHistory(generation, { stopWhenExhausted: false });
      if (!this.isCurrentOperation(generation)) {
        return { result: { status: "superseded" }, resumePlaybackId: null };
      }
      return { result: { status: "removed" }, resumePlaybackId: null };
    }

    this.publish();
    return {
      result: { status: "removed" },
      resumePlaybackId: resumePendingAdvance ? endedPlaybackId : null,
    };
  }

  setRepeatOneEnabled(enabled: boolean) {
    if (this.repeatOneEnabled === enabled) return;
    this.repeatOneEnabled = enabled;
    this.publish();
  }

  setShuffleEnabled(enabled: boolean) {
    if (this.shuffleEnabled === enabled) return;
    this.shuffleEnabled = enabled;
    if (enabled) {
      this.remainingCandidates = this.orderCandidates(this.remainingCandidates);
    } else if (this.currentRowKey !== null) {
      this.remainingCandidates = this.roundTracks.slice(this.currentQueueIndex() + 1);
    } else {
      this.remainingCandidates = this.restoreCandidateOrder(this.remainingCandidates);
    }
    this.publish();
  }

  observePlaybackState(
    playbackId: number,
    isPlaying: boolean,
    hasReachedEnd: boolean,
  ): Promise<boolean> {
    this.reconcilePlaybackId(playbackId);
    if (!hasReachedEnd) {
      this.rearmPlaybackEnd(playbackId, isPlaying);
      return Promise.resolve(false);
    }
    if (this.isPlaybackEndSuppressed(playbackId)) return Promise.resolve(false);

    return this.scheduleAdvance(playbackId);
  }

  get gaplessPlan(): { playbackId: number; candidates: PlaybackDisplayTrack[] } | null {
    const playbackId = this.activePlaybackId;
    if (playbackId === null) return null;
    if (this.ignoredEndPlaybackId === playbackId || this.handledEndPlaybackId === playbackId) {
      return { playbackId, candidates: [] };
    }
    const current = this.displayedTracks.find((item) => item.rowKey === this.currentRowKey);
    if (!current) return { playbackId, candidates: [] };
    const following = !this.shuffleEnabled
      ? this.roundTracks.slice(this.currentQueueIndex() + 1)
      : [
          ...this.playbackHistory
            .slice(this.historyIndex + 1)
            .map((key) => this.findRoundTrack(key))
            .filter((item): item is QueueTrack => item !== undefined),
          ...this.remainingCandidates,
        ];
    return {
      playbackId,
      candidates: (this.repeatOneEnabled ? [current, ...following] : following).map(
        toPlaybackDisplayTrack,
      ),
    };
  }

  confirmGaplessTransition(
    previousPlaybackId: number,
    playbackId: number,
    rowKey: string,
    trackId: number,
  ): boolean {
    const plan = this.gaplessPlan;
    if (plan?.playbackId !== previousPlaybackId) return false;
    const item = plan.candidates.find(
      (candidate) => candidate.rowKey === rowKey && candidate.trackId === trackId,
    );
    if (!item) return false;
    if (rowKey !== this.currentRowKey) {
      if (!this.shuffleEnabled) {
        const index = this.roundTracks.findIndex((track) => track.rowKey === rowKey);
        this.remainingCandidates = this.roundTracks.slice(index + 1);
        this.applyPlaybackHistory(item, { kind: "append" });
      } else {
        const historyIndex = this.playbackHistory.indexOf(rowKey, this.historyIndex + 1);
        if (historyIndex >= 0) {
          this.applyPlaybackHistory(item, { kind: "move", index: historyIndex });
        } else {
          const index = this.remainingCandidates.findIndex((track) => track.rowKey === rowKey);
          this.remainingCandidates = this.remainingCandidates.slice(index + 1);
          this.applyPlaybackHistory(item, { kind: "append" });
        }
      }
    }
    this.currentRowKey = rowKey;
    this.activePlaybackId = playbackId;
    this.handledEndPlaybackId = null;
    this.ignoredEndPlaybackId = null;
    this.publish();
    return true;
  }

  reportPreparationFailure(item: PlaybackDisplayTrack, failure: PlaybackStartFailure) {
    this.failures = [...this.failures, formatFailure(item, failure)];
    this.publish();
  }

  invalidatePendingAdvance() {
    this.operationGeneration += 1;
  }

  suppressPlaybackEnd(playbackId: number | null) {
    if (playbackId !== null) this.ignoredEndPlaybackId = playbackId;
  }

  allowPlaybackEnd(playbackId: number | null) {
    if (playbackId !== null && this.ignoredEndPlaybackId === playbackId) {
      this.ignoredEndPlaybackId = null;
    }
  }

  private beginUserOperation() {
    this.operationGeneration += 1;
    this.supersedeCurrentPlayback();
    this.failures = [];
    this.publish();
    return this.operationGeneration;
  }

  private isCurrentOperation(generation: number) {
    return generation === this.operationGeneration;
  }

  private reconcilePlaybackId(playbackId: number) {
    if (this.activePlaybackId === playbackId) return;
    this.activePlaybackId = playbackId;
    this.handledEndPlaybackId = null;
    this.ignoredEndPlaybackId = null;
  }

  private rearmPlaybackEnd(playbackId: number, isPlaying: boolean) {
    if (!isPlaying) return;
    if (this.handledEndPlaybackId === playbackId) this.handledEndPlaybackId = null;
    if (this.ignoredEndPlaybackId === playbackId) this.ignoredEndPlaybackId = null;
  }

  private isPlaybackEndSuppressed(playbackId: number) {
    return this.handledEndPlaybackId === playbackId || this.ignoredEndPlaybackId === playbackId;
  }

  private currentQueueIndex() {
    return this.roundTracks.findIndex((item) => item.rowKey === this.currentRowKey);
  }

  private hasNextTarget() {
    if (!this.shuffleEnabled && this.currentRowKey !== null) {
      const index = this.currentQueueIndex();
      return index >= 0 && index + 1 < this.roundTracks.length;
    }
    return (
      this.historyIndex + 1 < this.playbackHistory.length || this.remainingCandidates.length > 0
    );
  }

  private async playSequential(direction: -1 | 1, generation: number, stopWhenExhausted: boolean) {
    const currentIndex = this.currentQueueIndex();
    if (currentIndex < 0) return false;
    for (
      let index = currentIndex + direction;
      index >= 0 && index < this.roundTracks.length;
      index += direction
    ) {
      if (!this.isCurrentOperation(generation)) return false;
      const item = this.roundTracks[index];
      if (!item) continue;
      const result = await this.playItem(item, generation, { replaceQueue: false });
      if (result === "cancelled") return false;
      if (result === "started") {
        this.remainingCandidates = this.roundTracks.slice(index + 1);
        this.publish();
        return true;
      }
    }
    if (direction === 1) {
      this.remainingCandidates = [];
      if (stopWhenExhausted) await this.stopCurrentPlayback(generation);
      else await this.finishCurrentPlayback(generation);
    }
    return false;
  }

  private async finishCurrentPlayback(generation: number) {
    const playbackId = this.activePlaybackId;
    if (playbackId === null) return;
    const canFinish = () =>
      this.isCurrentOperation(generation) &&
      this.activePlaybackId === playbackId &&
      this.handledEndPlaybackId === playbackId &&
      this.ignoredEndPlaybackId !== playbackId;
    if (!canFinish()) return;
    try {
      await this.finishPlayback(playbackId, canFinish);
    } catch (error) {
      if (!canFinish()) return;
      this.failures = [...this.failures, `播放结束归零失败：${errorMessage(error)}`];
      this.publish();
    }
  }

  private async playPreviousFromHistory(generation: number) {
    for (let index = this.historyIndex - 1; index >= 0; index -= 1) {
      if (!this.isCurrentOperation(generation)) return false;
      const rowKey = this.playbackHistory[index];
      const item = rowKey ? this.findRoundTrack(rowKey) : undefined;
      if (!item) continue;

      const result = await this.playItem(item, generation, {
        replaceQueue: false,
        historyAction: { kind: "move", index },
      });
      if (result === "started") return true;
      if (result === "cancelled") return false;
    }
    return false;
  }

  private async playNextFromHistory(generation: number, options: { stopWhenExhausted: boolean }) {
    if (!this.shuffleEnabled && this.currentRowKey !== null) {
      return this.playSequential(1, generation, options.stopWhenExhausted);
    }
    for (let index = this.historyIndex + 1; index < this.playbackHistory.length; index += 1) {
      if (!this.isCurrentOperation(generation)) return false;
      const rowKey = this.playbackHistory[index];
      const item = rowKey ? this.findRoundTrack(rowKey) : undefined;
      if (!item) continue;

      const result = await this.playItem(item, generation, {
        replaceQueue: false,
        historyAction: { kind: "move", index },
      });
      if (result === "started") return true;
      if (result === "cancelled") return false;
    }
    return this.playNextCandidate(generation, false, options);
  }

  private getNextInsertionIndex(tracks: readonly QueueTrack[]) {
    const currentIndex = tracks.findIndex((item) => item.rowKey === this.currentRowKey);
    return currentIndex < 0 ? 0 : currentIndex + 1;
  }

  private createQueueItems(tracks: readonly NewQueueTrack[], isNext = false) {
    const reservedRowKeys = new Set<string>();
    return tracks.map((track) => {
      const item = this.createQueueItem(track, isNext, reservedRowKeys);
      reservedRowKeys.add(item.rowKey);
      return item;
    });
  }

  private createQueueItem(
    track: NewQueueTrack,
    isNext = false,
    reservedRowKeys: ReadonlySet<string> = new Set(),
  ): QueueTrack {
    const existingRowKeys = new Set([
      ...this.displayedTracks.map((item) => item.rowKey),
      ...this.roundTracks.map((item) => item.rowKey),
      ...this.remainingCandidates.map((item) => item.rowKey),
      ...this.playbackHistory,
      ...(this.currentRowKey === null ? [] : [this.currentRowKey]),
      ...reservedRowKeys,
    ]);
    const generatedKey = globalThis.crypto.randomUUID();
    let rowKey = generatedKey;
    let suffix = 1;
    while (existingRowKeys.has(rowKey)) {
      rowKey = `${generatedKey}:${suffix}`;
      suffix += 1;
    }
    return { ...track, rowKey, isNext };
  }

  private findRoundTrack(rowKey: string) {
    return this.roundTracks.find((item) => item.rowKey === rowKey);
  }

  private removeFromPlaybackHistory(removedRowKeys: ReadonlySet<string>) {
    const currentHistoryRowKey = this.playbackHistory[this.historyIndex] ?? null;
    const removesHistoryCursor =
      currentHistoryRowKey !== null && removedRowKeys.has(currentHistoryRowKey);
    const retainedBeforeCursor = this.playbackHistory
      .slice(0, Math.max(0, this.historyIndex))
      .filter((key) => !removedRowKeys.has(key)).length;

    this.playbackHistory = this.playbackHistory.filter((key) => !removedRowKeys.has(key));
    if (removesHistoryCursor) {
      this.historyIndex = retainedBeforeCursor - 1;
      return;
    }
    if (currentHistoryRowKey !== null) {
      this.historyIndex = this.playbackHistory.indexOf(currentHistoryRowKey);
      return;
    }
    this.historyIndex = Math.min(this.historyIndex, this.playbackHistory.length - 1);
  }

  private scheduleAdvance(playbackId: number) {
    const endedRowKey = this.currentRowKey;
    const generation = this.operationGeneration;
    this.handledEndPlaybackId = playbackId;

    return this.enqueue(() => {
      if (
        !this.isCurrentOperation(generation) ||
        this.activePlaybackId !== playbackId ||
        this.currentRowKey !== endedRowKey
      ) {
        return Promise.resolve(false);
      }

      const currentItem = this.displayedTracks.find((item) => item.rowKey === endedRowKey);
      if (!currentItem) return Promise.resolve(false);

      if (this.repeatOneEnabled) {
        return this.repeatCurrentOrAdvance(currentItem, generation);
      }
      return this.playNextFromHistory(generation, { stopWhenExhausted: false });
    });
  }

  private supersedeCurrentPlayback() {
    if (this.activePlaybackId !== null) {
      this.ignoredEndPlaybackId = this.activePlaybackId;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async playRound(
    queue: readonly QueueTrack[],
    startIndex: number,
    generation: number,
    replaceQueue: boolean,
  ) {
    this.roundTracks = queue.map((track) => ({ ...track }));
    this.remainingCandidates = this.orderCandidates(this.roundTracks.slice(startIndex + 1));
    this.playbackHistory = [];
    this.historyIndex = -1;
    this.publish();

    const firstItem = this.roundTracks[startIndex];
    if (!firstItem) return false;

    const firstResult = await this.playItem(firstItem, generation, { replaceQueue });
    if (firstResult === "started") return true;
    if (firstResult === "cancelled") return false;
    return this.playNextCandidate(generation, replaceQueue);
  }

  private async repeatCurrentOrAdvance(
    item: PlaybackDisplayTrack,
    generation: number,
  ): Promise<boolean> {
    const result = await this.playItem(item, generation, {
      replaceQueue: false,
      repeatRestart: true,
      historyAction: { kind: "none" },
    });
    if (result === "started") return true;
    if (result === "failed") {
      return this.playNextFromHistory(generation, { stopWhenExhausted: false });
    }
    if (!this.isCurrentOperation(generation)) return false;
    return this.repeatOneEnabled
      ? false
      : this.playNextFromHistory(generation, { stopWhenExhausted: false });
  }

  private applyPlaybackHistory(item: PlaybackDisplayTrack, action: PlaybackHistoryAction) {
    if (action.kind === "none") return;
    if (action.kind === "move") {
      if (this.playbackHistory[action.index] === item.rowKey) this.historyIndex = action.index;
      return;
    }

    this.playbackHistory = this.playbackHistory.slice(0, this.historyIndex + 1);
    this.playbackHistory.push(item.rowKey);
    this.historyIndex = this.playbackHistory.length - 1;
  }

  private async stopCurrentPlayback(generation: number) {
    const playbackId = this.activePlaybackId;
    if (!this.isCurrentOperation(generation) || playbackId === null) return false;

    const rowKey = this.currentRowKey;
    const currentItem = rowKey ? this.findRoundTrack(rowKey) : undefined;
    this.currentRowKey = null;
    this.activePlaybackId = null;
    this.handledEndPlaybackId = null;
    this.ignoredEndPlaybackId = playbackId;
    this.publish();

    try {
      await this.stopPlayback(playbackId);
    } catch (error) {
      if (!this.isCurrentOperation(generation)) return false;
      this.failures = [...this.failures, formatStopFailure(currentItem ?? null, error)];
      this.publish();
    }
    return false;
  }

  private async playNextCandidate(
    generation: number,
    replaceQueue: boolean,
    options: NextCandidateOptions = {},
  ): Promise<boolean> {
    const { stopWhenExhausted = false } = options;
    while (this.isCurrentOperation(generation)) {
      const item = this.remainingCandidates.shift();
      if (!item) {
        if (stopWhenExhausted) await this.stopCurrentPlayback(generation);
        else await this.finishCurrentPlayback(generation);
        return false;
      }

      const result = await this.playItem(item, generation, { replaceQueue });
      if (result === "started") return true;
      if (result === "cancelled") {
        if (this.roundTracks.some((track) => track.rowKey === item.rowKey)) {
          this.remainingCandidates.unshift(item);
          this.publish();
        }
        return false;
      }
    }

    return false;
  }

  private async playItem(
    item: PlaybackDisplayTrack,
    generation: number,
    options: PlayItemOptions,
  ): Promise<ItemPlaybackResult> {
    const { replaceQueue, repeatRestart = false, historyAction = { kind: "append" } } = options;
    if (!this.isCurrentOperation(generation)) return "cancelled";

    const result = await this.attemptPlayback(
      item.trackId,
      () => this.isCurrentOperation(generation) && (!repeatRestart || this.repeatOneEnabled),
      item.rowKey,
    );
    if (result.status === "cancelled") return "cancelled";

    if (result.status === "failed") {
      if (!this.isCurrentOperation(generation)) return "cancelled";
      this.failures = [...this.failures, formatFailure(item, result.failure)];
      this.publish();
      return "failed";
    }

    if (!this.isCurrentOperation(generation)) {
      try {
        await this.stopStalePlayback(result.playbackId);
      } catch (error) {
        if (this.isCurrentOperation(generation)) {
          this.failures = [...this.failures, formatStopFailure(item, error)];
          this.publish();
        }
      }
      return "cancelled";
    }

    if (replaceQueue) this.displayedTracks = this.roundTracks.map((track) => ({ ...track }));
    this.applyPlaybackHistory(item, historyAction);
    this.currentRowKey = item.rowKey;
    this.activePlaybackId = result.playbackId;
    this.handledEndPlaybackId = null;
    this.ignoredEndPlaybackId = null;
    this.publish();
    return "started";
  }

  private orderCandidates(candidates: QueueTrack[]) {
    const prioritized = candidates.filter((item) => item.isNext);
    const regular = candidates.filter((item) => !item.isNext);
    return [...prioritized, ...(this.shuffleEnabled ? this.shuffleCandidates(regular) : regular)];
  }

  private shuffleCandidates(candidates: QueueTrack[]) {
    const shuffled = [...candidates];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(this.random() * (index + 1));
      const current = shuffled[index];
      const selected = shuffled[randomIndex];
      if (!current || !selected) continue;
      shuffled[index] = selected;
      shuffled[randomIndex] = current;
    }
    return shuffled;
  }

  private restoreCandidateOrder(candidates: QueueTrack[]) {
    const queueIndex = new Map(this.roundTracks.map((item, index) => [item.rowKey, index]));
    const byQueueOrder = (left: QueueTrack, right: QueueTrack) =>
      (queueIndex.get(left.rowKey) ?? Number.MAX_SAFE_INTEGER) -
      (queueIndex.get(right.rowKey) ?? Number.MAX_SAFE_INTEGER);
    const prioritized = candidates.filter((item) => item.isNext).sort(byQueueOrder);
    const regular = candidates.filter((item) => !item.isNext).sort(byQueueOrder);
    return [...prioritized, ...regular];
  }

  private createPersistenceSnapshot(): PlaybackQueuePersistenceSnapshot {
    return {
      displayedTracks: this.displayedTracks.map(toPlaybackDisplayTrack),
      currentRowKey: this.currentRowKey,
      nextRowKeys: this.displayedTracks.flatMap((track) => (track.isNext ? [track.rowKey] : [])),
      shuffleEnabled: this.shuffleEnabled,
      repeatOneEnabled: this.repeatOneEnabled,
    };
  }

  private publish() {
    this.onStateChange(this.snapshot, this.createPersistenceSnapshot());
  }
}

function toPlaybackDisplayTrack(track: QueueTrack): PlaybackDisplayTrack {
  return {
    trackId: track.trackId,
    rowKey: track.rowKey,
    title: track.title,
    album: track.album,
    durationMs: track.durationMs,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function formatStopFailure(item: PlaybackDisplayTrack | null, error: unknown) {
  return `${item?.title ?? "未知曲目"}：停止播放失败：${errorMessage(error)}`;
}

function formatFailure(item: PlaybackDisplayTrack, failure: PlaybackStartFailure) {
  const title = item.title ?? "未知曲目";
  const reason = failure.kind === "audio-file-not-found" ? "音频文件不存在" : "播放失败";
  const detail = failure.message.trim();
  return `${title}：${reason}${detail ? `：${detail}` : ""}`;
}
