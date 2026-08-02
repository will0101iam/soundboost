import type { RNNoiseNode } from "simple-rnnoise-wasm";
import {
  createPeakCeilingCurve,
  mapDspSettings,
  type AudioSettings,
} from "./config";
import { AudioOutputDeviceError } from "./devices";

export type EngineState =
  | "idle"
  | "loading-model"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export type EngineEvent =
  | "LOAD"
  | "MODEL_READY"
  | "STARTED"
  | "STOP"
  | "STOPPED"
  | "FAIL";

export const initialEngineState: EngineState = "idle";

const transitions: Partial<
  Record<EngineState, Partial<Record<EngineEvent, EngineState>>>
> = {
  idle: { LOAD: "loading-model" },
  "loading-model": { MODEL_READY: "starting", FAIL: "error" },
  starting: { STARTED: "running", FAIL: "error" },
  running: { STOP: "stopping", FAIL: "error" },
  stopping: { STOPPED: "idle", FAIL: "error" },
  error: { LOAD: "loading-model", STOPPED: "idle" },
};

export function nextEngineState(
  state: EngineState,
  event: EngineEvent,
): EngineState {
  return transitions[state]?.[event] ?? state;
}

export function toAudioErrorMessage(error: unknown) {
  if (error instanceof AudioOutputDeviceError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风权限被拒绝，请在浏览器设置中允许访问。";
  }
  return error instanceof Error ? error.message : "实时扩音启动失败。";
}

export function denoiseMix(enabled: boolean) {
  return enabled
    ? { denoised: 1, bypass: 0 }
    : { denoised: 0, bypass: 1 };
}

export type EngineStartOptions = {
  denoiseEnabled: boolean;
  outputDeviceId?: string;
  onVad?: (probability: number) => void;
  onDenoiseUnavailable?: (error: unknown) => void;
  onTrackEnded?: () => void;
};

export type RealtimeAudioEngineDependencies = {
  createAudioContext?: (options: AudioContextOptions) => AudioContext;
  createRnnoiseNode?: (context: AudioContext) => Promise<RNNoiseNode>;
};

type SinkSelectableAudioContext = AudioContext & {
  setSinkId: (sinkId: string) => Promise<void>;
};

function canSetSinkId(
  context: AudioContext,
): context is SinkSelectableAudioContext {
  return (
    "setSinkId" in context &&
    typeof (context as Partial<SinkSelectableAudioContext>).setSinkId ===
      "function"
  );
}

function disconnect(node: AudioNode | null) {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // A partially constructed graph can contain nodes that were never connected.
  }
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

type EngineSession = {
  generation: number;
  context: AudioContext;
  stream: MediaStream;
  disposed: boolean;
  closePromise: Promise<void> | null;
  source: MediaStreamAudioSourceNode | null;
  inputAnalyser: AnalyserNode | null;
  rnnoise: RNNoiseNode | null;
  denoisedGain: GainNode | null;
  bypassGain: GainNode | null;
  highpass: BiquadFilterNode | null;
  lowShelf: BiquadFilterNode | null;
  presence: BiquadFilterNode | null;
  brightness: BiquadFilterNode | null;
  compressor: DynamicsCompressorNode | null;
  outputGain: GainNode | null;
  limiter: DynamicsCompressorNode | null;
  peakCeiling: WaveShaperNode | null;
  peakCeilingDb: number | null;
  outputAnalyser: AnalyserNode | null;
  onVad: ((probability: number) => void) | null;
  onTrackEnded: (() => void) | null;
  trackEndedListeners: Array<{
    track: MediaStreamTrack;
    listener: EventListener;
  }>;
  trackEndedNotified: boolean;
  inputLevelData: Uint8Array<ArrayBuffer> | null;
  outputLevelData: Uint8Array<ArrayBuffer> | null;
  denoiseEnabled: boolean;
};

export class RealtimeAudioEngine {
  private readonly createAudioContext: (
    options: AudioContextOptions,
  ) => AudioContext;
  private readonly createRnnoiseNode: (
    context: AudioContext,
  ) => Promise<RNNoiseNode>;
  private generation = 0;
  private session: EngineSession | null = null;

  constructor(dependencies: RealtimeAudioEngineDependencies = {}) {
    this.createAudioContext =
      dependencies.createAudioContext ??
      ((options) => new AudioContext(options));
    this.createRnnoiseNode =
      dependencies.createRnnoiseNode ??
      (async (context) => {
        const { createRnnoiseNode } = await import("./rnnoise");
        return createRnnoiseNode(context);
      });
  }

  async start(
    stream: MediaStream,
    settings: AudioSettings,
    options: EngineStartOptions,
  ) {
    const generation = ++this.generation;
    const previous = this.session;
    this.session = null;
    const previousClose = this.disposeSession(previous);
    let context: AudioContext;

    try {
      context = this.createAudioContext({
        latencyHint: "interactive",
        sampleRate: 48000,
      });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      await previousClose;
      throw error;
    }

    const session: EngineSession = {
      generation,
      context,
      stream,
      disposed: false,
      closePromise: null,
      source: null,
      inputAnalyser: null,
      rnnoise: null,
      denoisedGain: null,
      bypassGain: null,
      highpass: null,
      lowShelf: null,
      presence: null,
      brightness: null,
      compressor: null,
      outputGain: null,
      limiter: null,
      peakCeiling: null,
      peakCeilingDb: null,
      outputAnalyser: null,
      onVad: options.onVad ?? null,
      onTrackEnded: options.onTrackEnded ?? null,
      trackEndedListeners: [],
      trackEndedNotified: false,
      inputLevelData: null,
      outputLevelData: null,
      denoiseEnabled: options.denoiseEnabled,
    };
    this.session = session;
    for (const track of stream.getTracks()) {
      const listener = () => this.handleTrackEnded(session);
      track.addEventListener("ended", listener);
      session.trackEndedListeners.push({ track, listener });
    }
    if (stream.getTracks().some((track) => track.readyState === "ended")) {
      this.handleTrackEnded(session);
    }

    try {
      await previousClose;
      if (!this.isCurrent(session)) {
        await this.disposeSession(session);
        return;
      }

      if (options.outputDeviceId && canSetSinkId(context)) {
        try {
          await context.setSinkId(options.outputDeviceId);
        } catch (error) {
          throw new AudioOutputDeviceError(error);
        }
        if (!this.isCurrent(session)) {
          await this.disposeSession(session);
          return;
        }
      }

      const source = context.createMediaStreamSource(stream);
      const inputAnalyser = context.createAnalyser();
      session.source = source;
      session.inputAnalyser = inputAnalyser;

      let rnnoise: RNNoiseNode | null = null;
      try {
        rnnoise = await this.createRnnoiseNode(context);
      } catch (error) {
        if (!this.isCurrent(session)) {
          await this.disposeSession(session);
          return;
        }
        session.denoiseEnabled = false;
        options.onDenoiseUnavailable?.(error);
      }
      if (!this.isCurrent(session)) {
        disposeRnnoise(rnnoise);
        await this.disposeSession(session);
        return;
      }

      const denoisedGain = context.createGain();
      const bypassGain = context.createGain();
      const initialMix = denoiseMix(
        rnnoise !== null && options.denoiseEnabled,
      );
      denoisedGain.gain.value = initialMix.denoised;
      bypassGain.gain.value = initialMix.bypass;
      const highpass = context.createBiquadFilter();
      const lowShelf = context.createBiquadFilter();
      const presence = context.createBiquadFilter();
      const brightness = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const outputGain = context.createGain();
      const limiter = context.createDynamicsCompressor();
      const peakCeiling = context.createWaveShaper();
      const outputAnalyser = context.createAnalyser();

      inputAnalyser.fftSize = 1024;
      outputAnalyser.fftSize = 1024;

      highpass.type = "highpass";
      highpass.Q.value = 0.7;

      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 280;

      presence.type = "peaking";
      presence.frequency.value = 2200;
      presence.Q.value = 1;

      brightness.type = "highshelf";
      brightness.frequency.value = 4200;

      compressor.knee.value = 20;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.18;

      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;
      peakCeiling.oversample = "none";

      session.rnnoise = rnnoise;
      session.denoisedGain = denoisedGain;
      session.bypassGain = bypassGain;
      session.highpass = highpass;
      session.lowShelf = lowShelf;
      session.presence = presence;
      session.brightness = brightness;
      session.compressor = compressor;
      session.outputGain = outputGain;
      session.limiter = limiter;
      session.peakCeiling = peakCeiling;
      session.outputAnalyser = outputAnalyser;

      if (rnnoise) {
        rnnoise.onstatus = (event) => {
          if (this.isCurrent(session)) {
            session.onVad?.(event.vadProb ?? 0);
          }
        };
      }

      this.applyInitialSettings(session, settings);

      source.connect(inputAnalyser);
      if (rnnoise) {
        inputAnalyser.connect(rnnoise).connect(denoisedGain);
        denoisedGain.connect(highpass);
      }
      inputAnalyser.connect(bypassGain);
      bypassGain.connect(highpass);
      highpass
        .connect(lowShelf)
        .connect(presence)
        .connect(brightness)
        .connect(compressor)
        .connect(outputGain)
        .connect(limiter)
        .connect(peakCeiling)
        .connect(outputAnalyser)
        .connect(context.destination);

      await context.resume();
      if (!this.isCurrent(session)) {
        await this.disposeSession(session);
      }
    } catch (error) {
      const cancelled = !this.isCurrent(session);
      if (this.session === session) {
        this.session = null;
      }
      await this.disposeSession(session);
      if (cancelled) return;
      throw error;
    }
  }

  private isCurrent(session: EngineSession) {
    return (
      this.session === session &&
      this.generation === session.generation &&
      !session.disposed
    );
  }

  private applyInitialSettings(
    session: EngineSession,
    settings: AudioSettings,
  ) {
    if (
      !session.highpass ||
      !session.lowShelf ||
      !session.presence ||
      !session.brightness ||
      !session.compressor ||
      !session.outputGain ||
      !session.limiter ||
      !session.peakCeiling
    ) {
      return;
    }

    const mapped = mapDspSettings(settings);
    session.highpass.frequency.value = mapped.lowCutHz;
    session.lowShelf.gain.value = mapped.lowShelfGain;
    session.presence.gain.value = mapped.presenceGain;
    session.brightness.gain.value = mapped.brightnessGain;
    session.compressor.threshold.value = mapped.compressorThreshold;
    session.compressor.ratio.value = mapped.compressorRatio;
    session.outputGain.gain.value = mapped.outputGain;
    session.limiter.threshold.value = mapped.limiterThreshold;
    session.peakCeiling.curve = createPeakCeilingCurve(
      mapped.limiterThreshold,
    );
    session.peakCeilingDb = mapped.limiterThreshold;
  }

  applySettings(settings: AudioSettings) {
    const session = this.session;
    if (
      !session ||
      !this.isCurrent(session) ||
      !session.highpass ||
      !session.lowShelf ||
      !session.presence ||
      !session.brightness ||
      !session.compressor ||
      !session.outputGain ||
      !session.limiter ||
      !session.peakCeiling
    ) {
      return;
    }

    const mapped = mapDspSettings(settings);
    const now = session.context.currentTime;
    const timeConstant = 0.025;

    session.highpass.frequency.setTargetAtTime(
      mapped.lowCutHz,
      now,
      timeConstant,
    );
    session.lowShelf.gain.setTargetAtTime(
      mapped.lowShelfGain,
      now,
      timeConstant,
    );
    session.presence.gain.setTargetAtTime(
      mapped.presenceGain,
      now,
      timeConstant,
    );
    session.brightness.gain.setTargetAtTime(
      mapped.brightnessGain,
      now,
      timeConstant,
    );
    session.compressor.threshold.setTargetAtTime(
      mapped.compressorThreshold,
      now,
      timeConstant,
    );
    session.compressor.ratio.setTargetAtTime(
      mapped.compressorRatio,
      now,
      timeConstant,
    );
    session.outputGain.gain.setTargetAtTime(
      mapped.outputGain,
      now,
      timeConstant,
    );
    session.limiter.threshold.setTargetAtTime(
      mapped.limiterThreshold,
      now,
      timeConstant,
    );
    if (session.peakCeilingDb !== mapped.limiterThreshold) {
      session.peakCeiling.curve = createPeakCeilingCurve(
        mapped.limiterThreshold,
      );
      session.peakCeilingDb = mapped.limiterThreshold;
    }
  }

  setDenoiseEnabled(enabled: boolean) {
    const session = this.session;
    if (
      !session ||
      !this.isCurrent(session) ||
      !session.rnnoise ||
      !session.denoisedGain ||
      !session.bypassGain ||
      session.denoiseEnabled === enabled
    ) {
      return;
    }

    const now = session.context.currentTime;
    const fadeOutEnd = now + 0.01;
    const fadeInEnd = fadeOutEnd + 0.01;
    const gains = [session.denoisedGain.gain, session.bypassGain.gain];
    const incoming = enabled
      ? session.denoisedGain.gain
      : session.bypassGain.gain;

    for (const gain of gains) {
      gain.cancelAndHoldAtTime(now);
      gain.linearRampToValueAtTime(0, fadeOutEnd);
      gain.setValueAtTime(0, fadeOutEnd);
    }
    incoming.linearRampToValueAtTime(1, fadeInEnd);
    session.denoiseEnabled = enabled;
  }

  requestVad() {
    this.session?.rnnoise?.update();
  }

  getInputAnalyser() {
    return this.session?.inputAnalyser ?? null;
  }

  getOutputAnalyser() {
    return this.session?.outputAnalyser ?? null;
  }

  readLevels() {
    const session = this.session;
    const inputAnalyser = session?.inputAnalyser;
    const outputAnalyser = session?.outputAnalyser;
    if (!inputAnalyser || !outputAnalyser) {
      return { input: 0, output: 0 };
    }

    if (
      !session.inputLevelData ||
      session.inputLevelData.length !== inputAnalyser.fftSize
    ) {
      session.inputLevelData = new Uint8Array(inputAnalyser.fftSize);
    }
    if (
      !session.outputLevelData ||
      session.outputLevelData.length !== outputAnalyser.fftSize
    ) {
      session.outputLevelData = new Uint8Array(outputAnalyser.fftSize);
    }

    return {
      input: meterLevel(inputAnalyser, session.inputLevelData),
      output: meterLevel(outputAnalyser, session.outputLevelData),
    };
  }

  stop() {
    this.generation += 1;
    const session = this.session;
    this.session = null;
    return this.disposeSession(session);
  }

  private handleTrackEnded(session: EngineSession) {
    if (!this.isCurrent(session) || session.trackEndedNotified) return;

    session.trackEndedNotified = true;
    const onTrackEnded = session.onTrackEnded;
    this.generation += 1;
    if (this.session === session) {
      this.session = null;
    }
    const closePromise = this.disposeSession(session);
    onTrackEnded?.();
    void closePromise.catch(() => {
      // An ended event has no caller to receive an asynchronous close error.
    });
  }

  private disposeSession(session: EngineSession | null) {
    if (!session) return Promise.resolve();
    if (session.disposed) {
      return session.closePromise ?? Promise.resolve();
    }

    session.disposed = true;
    if (this.session === session) {
      this.session = null;
    }

    const rnnoise = session.rnnoise;
    const nodes: Array<AudioNode | null> = [
      session.source,
      session.inputAnalyser,
      session.denoisedGain,
      session.bypassGain,
      session.highpass,
      session.lowShelf,
      session.presence,
      session.brightness,
      session.compressor,
      session.outputGain,
      session.limiter,
      session.peakCeiling,
      session.outputAnalyser,
    ];

    session.onVad = null;
    session.onTrackEnded = null;
    for (const { track, listener } of session.trackEndedListeners) {
      track.removeEventListener("ended", listener);
    }
    session.trackEndedListeners = [];
    disposeRnnoise(rnnoise);
    nodes.forEach(disconnect);
    session.stream.getTracks().forEach((track) => track.stop());

    if (session.context.state === "closed") {
      session.closePromise = Promise.resolve();
    } else {
      try {
        session.closePromise = Promise.resolve(session.context.close());
      } catch (error) {
        session.closePromise = Promise.reject(error);
      }
    }
    return session.closePromise;
  }
}

function disposeRnnoise(rnnoise: RNNoiseNode | null) {
  if (!rnnoise) return;
  rnnoise.onstatus = null;
  try {
    rnnoise.update(false);
  } catch {
    // The worklet may already have stopped after an initialization failure.
  }
  disconnect(rnnoise);
}

function meterLevel(
  analyser: AnalyserNode,
  data: Uint8Array<ArrayBuffer>,
) {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const value of data) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 5);
}
