import type { PlaybackQueuePersistenceSnapshot } from "@/composables/playbackQueuePersistence";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

export type PlaybackStartFailure = {
  kind: "audio-file-not-found" | "playback-failed";
  message: string;
};

export type QueuePlaybackAttempt =
  | { status: "started"; playbackId: number }
  | { status: "failed"; failure: PlaybackStartFailure }
  | { status: "cancelled" };

export type QueuePlaybackStatus = {
  hasAudio: boolean;
  isPlaying: boolean;
  hasEnded: boolean;
  playbackId: number | null;
  positionMs: number;
  durationMs: number;
};

export type PlaybackStatusObservation = {
  status: QueuePlaybackStatus;
  currentPlaybackId: number | null;
  currentTrackId: number | null;
  isCommandPending: boolean;
  isSeeking: boolean;
};

export type PlaybackQueueSnapshot = {
  displayedTracks: readonly PlaybackDisplayTrack[];
  currentRowKey: string | null;
  queuePlaybackError: string;
  repeatOneEnabled: boolean;
  shuffleEnabled: boolean;
  canPlayPrevious: boolean;
  canPlayNext: boolean;
};

type AttemptPlayback = (trackId: number, canStart: () => boolean) => Promise<QueuePlaybackAttempt>;
type StopPlayback = (playbackId: number) => Promise<boolean>;
type StopStalePlayback = (playbackId: number) => Promise<void>;
type PlaybackQueueCoordinatorOptions = {
  random?: () => number;
  stopPlayback?: StopPlayback;
  stopStalePlayback?: StopStalePlayback;
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

export class PlaybackQueueCoordinator {
  private displayedTracks: PlaybackDisplayTrack[] = [];
  private currentRowKey: string | null = null;
  private failures: string[] = [];
  private repeatOneEnabled = false;
  private shuffleEnabled = false;
  private roundTracks: PlaybackDisplayTrack[] = [];
  private remainingCandidates: PlaybackDisplayTrack[] = [];
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

  constructor(
    private readonly attemptPlayback: AttemptPlayback,
    private readonly onStateChange: (snapshot: PlaybackQueueSnapshot) => void,
    options: PlaybackQueueCoordinatorOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.stopPlayback = options.stopPlayback ?? (async () => true);
    this.stopStalePlayback = options.stopStalePlayback ?? (async () => {});
  }

  get snapshot(): PlaybackQueueSnapshot {
    return {
      displayedTracks: this.displayedTracks.map((track) => ({ ...track })),
      currentRowKey: this.currentRowKey,
      queuePlaybackError: this.failures.join("\n"),
      repeatOneEnabled: this.repeatOneEnabled,
      shuffleEnabled: this.shuffleEnabled,
      canPlayPrevious: this.historyIndex > 0,
      canPlayNext: this.hasNextTarget(),
    };
  }

  restoreQueue(snapshot: PlaybackQueuePersistenceSnapshot) {
    this.operationGeneration += 1;
    this.displayedTracks = snapshot.displayedTracks.map((track) => ({ ...track }));
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
    const queue = items.map((item) => ({ ...item }));
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
    if (this.historyIndex <= 0) return Promise.resolve(false);

    const generation = this.beginUserOperation();
    return this.enqueue(() => {
      if (!this.isCurrentOperation(generation)) return Promise.resolve(false);
      return this.playPreviousFromHistory(generation);
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

  async removeQueueItem(rowKey: string): Promise<boolean> {
    const removedItem = this.displayedTracks.find((item) => item.rowKey === rowKey);
    if (!removedItem) return false;

    const removesCurrentItem = this.currentRowKey === rowKey;
    const endedPlaybackId = this.activePlaybackId;
    const resumePendingAdvance =
      !removesCurrentItem &&
      endedPlaybackId !== null &&
      this.handledEndPlaybackId === endedPlaybackId &&
      this.ignoredEndPlaybackId !== endedPlaybackId;
    const generation = ++this.operationGeneration;

    this.displayedTracks = this.displayedTracks.filter((item) => item.rowKey !== rowKey);
    this.roundTracks = this.roundTracks.filter((item) => item.rowKey !== rowKey);
    this.remainingCandidates = this.remainingCandidates.filter((item) => item.rowKey !== rowKey);
    this.removeFromPlaybackHistory(rowKey);
    this.failures = [];

    if (removesCurrentItem) {
      this.currentRowKey = null;
      this.activePlaybackId = null;
      this.handledEndPlaybackId = null;
      if (endedPlaybackId !== null) this.ignoredEndPlaybackId = endedPlaybackId;

      const stopResult = (
        endedPlaybackId === null ? Promise.resolve(true) : this.stopPlayback(endedPlaybackId)
      ).then(
        (canAdvance) => ({ status: "completed" as const, canAdvance }),
        (error: unknown) => ({ status: "failed" as const, error }),
      );
      this.publish();

      return this.enqueue(async () => {
        const stopOutcome = await stopResult;
        if (!this.isCurrentOperation(generation)) return false;

        if (stopOutcome.status === "failed") {
          this.failures = [formatStopFailure(removedItem, stopOutcome.error)];
          this.publish();
          return false;
        }
        if (!stopOutcome.canAdvance) return false;

        await this.playNextCandidate(generation, false);
        return true;
      });
    }

    this.publish();
    if (resumePendingAdvance && endedPlaybackId !== null) {
      await this.scheduleAdvance(endedPlaybackId);
    }
    return true;
  }

  setRepeatOneEnabled(enabled: boolean) {
    if (this.repeatOneEnabled === enabled) return;
    this.repeatOneEnabled = enabled;
    this.publish();
  }

  setShuffleEnabled(enabled: boolean) {
    if (this.shuffleEnabled === enabled) return;
    this.shuffleEnabled = enabled;
    this.remainingCandidates = enabled
      ? this.shuffleCandidates(this.remainingCandidates)
      : this.restoreCandidateOrder(this.remainingCandidates);
    this.publish();
  }

  observePlaybackStatus(observation: PlaybackStatusObservation): Promise<boolean> {
    if (!this.isCurrentObservation(observation)) return Promise.resolve(false);

    const { status } = observation;
    const playbackId = status.playbackId;
    if (playbackId === null) return Promise.resolve(false);
    this.reconcilePlaybackId(playbackId);

    const hasReachedEnd =
      status.hasEnded || (status.durationMs > 0 && status.positionMs >= status.durationMs);
    if (!hasReachedEnd) {
      this.rearmPlaybackEnd(playbackId, status.isPlaying);
      return Promise.resolve(false);
    }
    if (this.isPlaybackEndSuppressed(playbackId)) return Promise.resolve(false);

    return this.scheduleAdvance(playbackId);
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

  private isCurrentObservation({
    status,
    currentPlaybackId,
    currentTrackId,
    isCommandPending,
    isSeeking,
  }: PlaybackStatusObservation) {
    if (
      isCommandPending ||
      isSeeking ||
      !status.hasAudio ||
      status.playbackId === null ||
      status.playbackId !== currentPlaybackId ||
      currentTrackId === null
    ) {
      return false;
    }

    const currentItem = this.displayedTracks.find((item) => item.rowKey === this.currentRowKey);
    return currentItem?.trackId === currentTrackId;
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

  private hasNextTarget() {
    return (
      this.historyIndex + 1 < this.playbackHistory.length ||
      this.remainingCandidates.length > 0 ||
      (this.currentRowKey !== null && this.activePlaybackId !== null)
    );
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

  private findRoundTrack(rowKey: string) {
    return this.roundTracks.find((item) => item.rowKey === rowKey);
  }

  private removeFromPlaybackHistory(rowKey: string) {
    const currentHistoryRowKey = this.playbackHistory[this.historyIndex] ?? null;
    const wasCurrentHistoryItem = currentHistoryRowKey === rowKey;
    const retainedBeforeCursor = this.playbackHistory
      .slice(0, Math.max(0, this.historyIndex))
      .filter((key) => key !== rowKey).length;

    this.playbackHistory = this.playbackHistory.filter((key) => key !== rowKey);
    if (wasCurrentHistoryItem) {
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
      return this.playNextCandidate(generation, false);
    });
  }

  private supersedeCurrentPlayback() {
    if (this.activePlaybackId !== null) {
      this.ignoredEndPlaybackId = this.activePlaybackId;
    }
  }

  private enqueue(operation: () => Promise<boolean>) {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async playRound(
    queue: readonly PlaybackDisplayTrack[],
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
    if (result === "failed") return this.playNextCandidate(generation, false);
    if (!this.isCurrentOperation(generation)) return false;
    return this.repeatOneEnabled ? false : this.playNextCandidate(generation, false);
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

  private orderCandidates(candidates: PlaybackDisplayTrack[]) {
    return this.shuffleEnabled ? this.shuffleCandidates(candidates) : candidates;
  }

  private shuffleCandidates(candidates: PlaybackDisplayTrack[]) {
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

  private restoreCandidateOrder(candidates: PlaybackDisplayTrack[]) {
    const queueIndex = new Map(this.roundTracks.map((item, index) => [item.rowKey, index]));
    return [...candidates].sort(
      (left, right) =>
        (queueIndex.get(left.rowKey) ?? Number.MAX_SAFE_INTEGER) -
        (queueIndex.get(right.rowKey) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  private publish() {
    this.onStateChange(this.snapshot);
  }
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
