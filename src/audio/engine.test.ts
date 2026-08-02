import { describe, expect, test, vi } from "vitest";
import type { RNNoiseNode } from "simple-rnnoise-wasm";
import {
  denoiseMix,
  initialEngineState,
  nextEngineState,
  RealtimeAudioEngine,
  SerialTaskQueue,
  toAudioErrorMessage,
} from "./engine";
import {
  createPeakCeilingCurve,
  dbToGain,
  DEFAULT_SETTINGS,
  mapDspSettings,
} from "./config";

describe("engine state", () => {
  test("按完整启动顺序进入 running", () => {
    let state = initialEngineState;

    expect(state).toBe("idle");
    state = nextEngineState(state, "LOAD");
    expect(state).toBe("loading-model");
    state = nextEngineState(state, "MODEL_READY");
    expect(state).toBe("starting");
    state = nextEngineState(state, "STARTED");
    expect(state).toBe("running");
  });

  test("启动失败进入 error", () => {
    expect(nextEngineState("starting", "FAIL")).toBe("error");
  });

  test("非法转换保持当前状态", () => {
    expect(nextEngineState("idle", "STARTED")).toBe("idle");
  });
});

describe("SerialTaskQueue", () => {
  test("等待前一个异步操作结束后再开始下一个", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = new SerialTaskQueue();

    const first = queue.run(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = queue.run(async () => {
      events.push("second:start");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("前一个操作失败后仍执行下一个", async () => {
    const queue = new SerialTaskQueue();

    await expect(
      queue.run(async () => {
        throw new Error("start failed");
      }),
    ).rejects.toThrow("start failed");
    await expect(queue.run(async () => "recovered")).resolves.toBe(
      "recovered",
    );
  });
});

describe("denoiseMix", () => {
  test("始终只打开一条音频支路", () => {
    expect(denoiseMix(true)).toEqual({ denoised: 1, bypass: 0 });
    expect(denoiseMix(false)).toEqual({ denoised: 0, bypass: 1 });
  });
});

describe("toAudioErrorMessage", () => {
  test("将权限拒绝转换为可执行提示", () => {
    expect(
      toAudioErrorMessage(new DOMException("", "NotAllowedError")),
    ).toContain("麦克风权限");
  });

  test("保留普通错误信息", () => {
    expect(toAudioErrorMessage(new Error("AudioWorklet 加载失败"))).toBe(
      "AudioWorklet 加载失败",
    );
  });

  test("为未知错误返回稳定提示", () => {
    expect(toAudioErrorMessage({ reason: "unknown" })).toBe(
      "实时扩音启动失败。",
    );
  });
});

type MockParam = AudioParam & {
  cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
};

type MockNode = AudioNode & {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function createParam(initialValue = 0): MockParam {
  return {
    value: initialValue,
    cancelAndHoldAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  } as unknown as MockParam;
}

function createNode<T extends object = object>(extra?: T) {
  const node = {
    connect: vi.fn((target: AudioNode) => target),
    disconnect: vi.fn(),
    ...extra,
  };
  return node as unknown as MockNode & T;
}

type MockTrack = MediaStreamTrack & {
  emitEnded: () => void;
  stop: ReturnType<typeof vi.fn>;
};

function createTrack(): MockTrack {
  const endedListeners = new Set<EventListener>();
  let readyState: MediaStreamTrackState = "live";
  let track: MockTrack;
  const addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type === "ended" && typeof listener === "function") {
        endedListeners.add(listener);
      }
    },
  );
  const removeEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type === "ended" && typeof listener === "function") {
        endedListeners.delete(listener);
      }
    },
  );
  track = {
    get readyState() {
      return readyState;
    },
    stop: vi.fn(),
    addEventListener,
    removeEventListener,
    emitEnded: () => {
      readyState = "ended";
      const event = new Event("ended");
      for (const listener of [...endedListeners]) {
        listener.call(track, event);
      }
    },
  } as unknown as MockTrack;
  return track;
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function createEngineHarness(options?: {
  deferRnnoise?: boolean;
  rnnoiseError?: Error;
  setSinkIdError?: DOMException;
  onDestinationConnect?: () => void;
}) {
  const source = createNode();
  const inputBuffers: Uint8Array[] = [];
  const outputBuffers: Uint8Array[] = [];
  const inputAnalyser = createNode({
    fftSize: 0,
    getByteTimeDomainData: vi.fn((buffer: Uint8Array) => {
      inputBuffers.push(buffer);
      buffer.fill(128);
    }),
  });
  const outputAnalyser = createNode({
    fftSize: 0,
    getByteTimeDomainData: vi.fn((buffer: Uint8Array) => {
      outputBuffers.push(buffer);
      buffer.fill(128);
    }),
  });
  const denoisedGain = createNode({ gain: createParam() });
  const bypassGain = createNode({ gain: createParam() });
  const highpass = createNode({
    type: "lowpass" as BiquadFilterType,
    frequency: createParam(350),
    Q: createParam(1),
    gain: createParam(),
  });
  const lowShelf = createNode({
    type: "lowpass" as BiquadFilterType,
    frequency: createParam(350),
    Q: createParam(1),
    gain: createParam(),
  });
  const presence = createNode({
    type: "lowpass" as BiquadFilterType,
    frequency: createParam(350),
    Q: createParam(1),
    gain: createParam(),
  });
  const brightness = createNode({
    type: "lowpass" as BiquadFilterType,
    frequency: createParam(350),
    Q: createParam(1),
    gain: createParam(),
  });
  const compressor = createNode({
    threshold: createParam(-24),
    knee: createParam(30),
    ratio: createParam(12),
    attack: createParam(0.003),
    release: createParam(0.25),
  });
  const outputGain = createNode({ gain: createParam(1) });
  const limiter = createNode({
    threshold: createParam(-24),
    knee: createParam(30),
    ratio: createParam(12),
    attack: createParam(0.003),
    release: createParam(0.25),
  });
  const peakCeiling = createNode({
    curve: null as Float32Array<ArrayBuffer> | null,
    oversample: "2x" as OverSampleType,
  });
  const destination = createNode();
  outputAnalyser.connect.mockImplementation((target: AudioNode) => {
    options?.onDestinationConnect?.();
    return target;
  });

  const biquads = [highpass, lowShelf, presence, brightness];
  const gains = [denoisedGain, bypassGain, outputGain];
  const compressors = [compressor, limiter];
  const setSinkId = options?.setSinkIdError
    ? vi.fn(async () => {
        throw options.setSinkIdError;
      })
    : vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const resume = vi.fn(async () => undefined);
  const context = {
    currentTime: 4,
    state: "running",
    destination,
    setSinkId,
    close,
    resume,
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi
      .fn()
      .mockReturnValueOnce(inputAnalyser)
      .mockReturnValueOnce(outputAnalyser),
    createGain: vi.fn(() => gains.shift()),
    createBiquadFilter: vi.fn(() => biquads.shift()),
    createDynamicsCompressor: vi.fn(() => compressors.shift()),
    createWaveShaper: vi.fn(() => peakCeiling),
  } as unknown as AudioContext;

  const rnnoise = createNode({
    onstatus: null as ((event: Event & { vadProb?: number }) => void) | null,
    update: vi.fn(),
  });
  let resolveRnnoise!: (node: RNNoiseNode) => void;
  const rnnoisePromise = options?.deferRnnoise
    ? new Promise<RNNoiseNode>((resolve) => {
        resolveRnnoise = resolve;
      })
    : null;
  const createRnnoiseNode = options?.rnnoiseError
    ? vi.fn(async () => {
        throw options.rnnoiseError;
      })
    : options?.deferRnnoise
      ? vi.fn(() => rnnoisePromise!)
      : vi.fn(async () => rnnoise as unknown as RNNoiseNode);
  const createAudioContext = vi.fn(() => context);
  const trackA = createTrack();
  const trackB = createTrack();
  const stream = {
    getTracks: vi.fn(() => [trackA, trackB]),
  } as unknown as MediaStream;
  const engine = new RealtimeAudioEngine({
    createAudioContext,
    createRnnoiseNode,
  });

  return {
    engine,
    context,
    stream,
    source,
    inputAnalyser,
    outputAnalyser,
    rnnoise,
    denoisedGain,
    bypassGain,
    highpass,
    lowShelf,
    presence,
    brightness,
    compressor,
    outputGain,
    limiter,
    peakCeiling,
    destination,
    createAudioContext,
    createRnnoiseNode,
    setSinkId,
    close,
    resume,
    resolveRnnoise: () => resolveRnnoise(rnnoise as unknown as RNNoiseNode),
    trackA,
    trackB,
    inputBuffers,
    outputBuffers,
  };
}

describe("RealtimeAudioEngine", () => {
  test.each([
    ["NotAllowedError", "输出设备未授权"],
    ["NotFoundError", "未找到可用输出设备"],
    ["AbortError", "输出设备切换失败"],
  ] as const)(
    "setSinkId 抛出 %s 时保留输出设备上下文",
    async (name, expectedMessage) => {
      const harness = createEngineHarness({
        setSinkIdError: new DOMException("", name),
      });
      let reason: unknown;

      try {
        await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
          denoiseEnabled: true,
          outputDeviceId: "airpods",
        });
      } catch (error) {
        reason = error;
      }

      const message = toAudioErrorMessage(reason);
      expect(message).toContain(expectedMessage);
      expect(message).not.toContain("麦克风");
      expect(harness.trackA.stop).toHaveBeenCalledTimes(1);
      expect(harness.trackB.stop).toHaveBeenCalledTimes(1);
      expect(harness.close).toHaveBeenCalledTimes(1);
    },
  );

  test("建立 RNNoise 与旁路互斥的实时处理拓扑并设置输出设备", async () => {
    const harness = createEngineHarness();

    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
      outputDeviceId: "airpods",
    });

    expect(harness.createAudioContext).toHaveBeenCalledWith({
      latencyHint: "interactive",
      sampleRate: 48000,
    });
    expect(harness.setSinkId).toHaveBeenCalledWith("airpods");
    expect(harness.source.connect).toHaveBeenCalledWith(harness.inputAnalyser);
    expect(harness.inputAnalyser.connect).toHaveBeenCalledWith(
      harness.rnnoise,
    );
    expect(harness.inputAnalyser.connect).toHaveBeenCalledWith(
      harness.bypassGain,
    );
    expect(harness.rnnoise.connect).toHaveBeenCalledWith(
      harness.denoisedGain,
    );
    expect(harness.denoisedGain.connect).toHaveBeenCalledWith(
      harness.highpass,
    );
    expect(harness.bypassGain.connect).toHaveBeenCalledWith(harness.highpass);
    expect(harness.limiter.connect).toHaveBeenCalledWith(
      harness.peakCeiling,
    );
    expect(harness.peakCeiling.connect).toHaveBeenCalledWith(
      harness.outputAnalyser,
    );
    expect(harness.outputAnalyser.connect).toHaveBeenCalledWith(
      harness.destination,
    );
    expect(harness.denoisedGain.gain.value).toBe(1);
    expect(harness.bypassGain.gain.value).toBe(0);
  });

  test("连接输出前同步写入完整初始 DSP 参数", async () => {
    const mapped = mapDspSettings(DEFAULT_SETTINGS);
    let snapshot: number[] | undefined;
    const harness = createEngineHarness({
      onDestinationConnect: () => {
        snapshot = [
          harness.highpass.frequency.value,
          harness.lowShelf.gain.value,
          harness.presence.gain.value,
          harness.brightness.gain.value,
          harness.compressor.threshold.value,
          harness.compressor.ratio.value,
          harness.outputGain.gain.value,
          harness.limiter.threshold.value,
        ];
      },
    });

    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
    });

    expect(snapshot).toEqual([
      mapped.lowCutHz,
      mapped.lowShelfGain,
      mapped.presenceGain,
      mapped.brightnessGain,
      mapped.compressorThreshold,
      mapped.compressorRatio,
      mapped.outputGain,
      mapped.limiterThreshold,
    ]);
    expect(harness.highpass.frequency.setTargetAtTime).not.toHaveBeenCalled();
    expect(harness.outputGain.gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  test("在动态压缩后应用确定性的数字样本峰值上限", async () => {
    const harness = createEngineHarness();
    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
    });

    const curve = harness.peakCeiling.curve;
    expect(curve).not.toBeNull();
    expect(harness.peakCeiling.oversample).toBe("none");
    expect(Math.max(...Array.from(curve ?? [], Math.abs))).toBeLessThanOrEqual(
      dbToGain(DEFAULT_SETTINGS.limit),
    );

    harness.engine.applySettings({
      ...DEFAULT_SETTINGS,
      limit: -14,
    });
    expect(harness.peakCeiling.curve).toEqual(
      createPeakCeilingCurve(-14),
    );
  });

  test("峰值上限未变化时复用曲线", async () => {
    const harness = createEngineHarness();
    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
    });
    const initialCurve = harness.peakCeiling.curve;

    harness.engine.applySettings({
      ...DEFAULT_SETTINGS,
      volume: 6,
      clarity: 60,
    });

    expect(harness.peakCeiling.curve).toBe(initialCurve);
  });

  test("传递 VAD、请求状态并平滑切换旁路", async () => {
    const onVad = vi.fn();
    const harness = createEngineHarness();
    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
      onVad,
    });

    harness.engine.requestVad();
    harness.rnnoise.onstatus?.({
      vadProb: 0.83,
    } as Event & { vadProb: number });
    harness.engine.setDenoiseEnabled(false);

    expect(harness.rnnoise.update).toHaveBeenCalledWith();
    expect(onVad).toHaveBeenCalledWith(0.83);
    expect(harness.denoisedGain.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(
      4,
    );
    expect(harness.bypassGain.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(4);
    expect(
      harness.denoisedGain.gain.linearRampToValueAtTime,
    ).toHaveBeenCalledWith(0, 4.01);
    expect(harness.bypassGain.gain.setValueAtTime).toHaveBeenCalledWith(
      0,
      4.01,
    );
    expect(
      harness.bypassGain.gain.linearRampToValueAtTime,
    ).toHaveBeenCalledWith(1, 4.02);

    const outgoingFadeEnd =
      harness.denoisedGain.gain.linearRampToValueAtTime.mock.calls[0][1];
    const incomingFadeStart =
      harness.bypassGain.gain.setValueAtTime.mock.calls.at(-1)?.[1];
    expect(incomingFadeStart).toBeGreaterThanOrEqual(outgoingFadeEnd);
  });

  test("RNNoise 加载悬挂时 stop 立即释放资源且晚返回节点不会复活图", async () => {
    const harness = createEngineHarness({ deferRnnoise: true });
    const startPromise = harness.engine.start(
      harness.stream,
      DEFAULT_SETTINGS,
      { denoiseEnabled: true },
    );
    await vi.waitFor(() => {
      expect(harness.createRnnoiseNode).toHaveBeenCalledTimes(1);
    });

    let stopResolved = false;
    const stopPromise = harness.engine.stop().then(() => {
      stopResolved = true;
    });
    await flushMicrotasks();

    const stoppedBeforeRnnoiseResolved = harness.trackA.stop.mock.calls.length;
    const closedBeforeRnnoiseResolved = harness.close.mock.calls.length;
    const stopFinishedBeforeRnnoiseResolved = stopResolved;

    harness.resolveRnnoise();
    await Promise.all([startPromise, stopPromise]);

    expect(stopFinishedBeforeRnnoiseResolved).toBe(true);
    expect(stoppedBeforeRnnoiseResolved).toBe(1);
    expect(closedBeforeRnnoiseResolved).toBe(1);
    expect(harness.source.connect).not.toHaveBeenCalled();
    expect(harness.rnnoise.update).toHaveBeenCalledWith(false);
    expect(harness.rnnoise.disconnect).toHaveBeenCalledTimes(1);
  });

  test("第二次 start 立即取消并释放首次启动，最终只保留第二条图", async () => {
    const first = createEngineHarness({ deferRnnoise: true });
    const second = createEngineHarness();
    const createAudioContext = vi
      .fn()
      .mockReturnValueOnce(first.context)
      .mockReturnValueOnce(second.context);
    const createRnnoiseNode = vi
      .fn()
      .mockImplementationOnce(first.createRnnoiseNode)
      .mockImplementationOnce(second.createRnnoiseNode);
    const engine = new RealtimeAudioEngine({
      createAudioContext,
      createRnnoiseNode,
    });

    const firstStart = engine.start(first.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
    });
    await vi.waitFor(() => {
      expect(first.createRnnoiseNode).toHaveBeenCalledTimes(1);
    });

    let secondStarted = false;
    const secondStart = engine
      .start(second.stream, DEFAULT_SETTINGS, { denoiseEnabled: true })
      .then(() => {
        secondStarted = true;
      });
    await flushMicrotasks();

    const firstStoppedBeforeResolve = first.trackA.stop.mock.calls.length;
    const firstClosedBeforeResolve = first.close.mock.calls.length;
    const secondFinishedBeforeResolve = secondStarted;

    first.resolveRnnoise();
    await Promise.all([firstStart, secondStart]);

    expect(firstStoppedBeforeResolve).toBe(1);
    expect(firstClosedBeforeResolve).toBe(1);
    expect(secondFinishedBeforeResolve).toBe(true);
    expect(first.source.connect).not.toHaveBeenCalled();
    expect(second.source.connect).toHaveBeenCalledWith(second.inputAnalyser);
    expect(second.trackA.stop).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  test("第二次 start 创建 Context 失败时仍释放首次图和新流", async () => {
    const first = createEngineHarness();
    const second = createEngineHarness();
    const failure = new Error("AudioContext failed");
    const createAudioContext = vi
      .fn()
      .mockReturnValueOnce(first.context)
      .mockImplementationOnce(() => {
        throw failure;
      });
    const engine = new RealtimeAudioEngine({
      createAudioContext,
      createRnnoiseNode: first.createRnnoiseNode,
    });
    await engine.start(first.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
    });

    await expect(
      engine.start(second.stream, DEFAULT_SETTINGS, {
        denoiseEnabled: true,
      }),
    ).rejects.toBe(failure);

    expect(first.trackA.stop).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.trackA.stop).toHaveBeenCalledTimes(1);
    expect(second.trackB.stop).toHaveBeenCalledTimes(1);
  });

  test("停止时释放完整图、媒体轨道和 Context，重复停止安全", async () => {
    const harness = createEngineHarness();
    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
    });

    await harness.engine.stop();
    await harness.engine.stop();

    expect(harness.rnnoise.update).toHaveBeenCalledWith(false);
    expect(harness.rnnoise.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.source.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.peakCeiling.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.trackA.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackB.stop).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  test("当前输入轨道意外结束时只通知一次并立即释放会话", async () => {
    const onTrackEnded = vi.fn();
    const harness = createEngineHarness();
    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
      onTrackEnded,
    });

    harness.trackA.emitEnded();
    harness.trackB.emitEnded();
    await flushMicrotasks();

    expect(onTrackEnded).toHaveBeenCalledTimes(1);
    expect(harness.trackA.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackB.stop).toHaveBeenCalledTimes(1);
    expect(harness.rnnoise.update).toHaveBeenCalledWith(false);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  test("订阅前已经结束的轨道不会启动音频图", async () => {
    const onTrackEnded = vi.fn();
    const harness = createEngineHarness();
    harness.trackA.emitEnded();

    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
      onTrackEnded,
    });

    expect(onTrackEnded).toHaveBeenCalledTimes(1);
    expect(harness.source.connect).not.toHaveBeenCalled();
    expect(harness.trackA.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackB.stop).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  test("正常停止会移除 ended 监听且不会误报断开", async () => {
    const onTrackEnded = vi.fn();
    const harness = createEngineHarness();
    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
      onTrackEnded,
    });

    await harness.engine.stop();
    harness.trackA.emitEnded();

    expect(onTrackEnded).not.toHaveBeenCalled();
    expect(harness.trackA.removeEventListener).toHaveBeenCalledWith(
      "ended",
      expect.any(Function),
    );
  });

  test("旧会话轨道结束不会停止或通知新会话", async () => {
    const first = createEngineHarness();
    const second = createEngineHarness();
    const firstEnded = vi.fn();
    const secondEnded = vi.fn();
    const engine = new RealtimeAudioEngine({
      createAudioContext: vi
        .fn()
        .mockReturnValueOnce(first.context)
        .mockReturnValueOnce(second.context),
      createRnnoiseNode: vi
        .fn()
        .mockImplementationOnce(first.createRnnoiseNode)
        .mockImplementationOnce(second.createRnnoiseNode),
    });

    await engine.start(first.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
      onTrackEnded: firstEnded,
    });
    await engine.start(second.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
      onTrackEnded: secondEnded,
    });

    first.trackA.emitEnded();
    await flushMicrotasks();

    expect(firstEnded).not.toHaveBeenCalled();
    expect(secondEnded).not.toHaveBeenCalled();
    expect(second.trackA.stop).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  test("RNNoise 启动失败时清理流和 Context 后重抛", async () => {
    const failure = new Error("RNNoise failed");
    const harness = createEngineHarness({ rnnoiseError: failure });

    await expect(
      harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
        denoiseEnabled: true,
      }),
    ).rejects.toBe(failure);

    expect(harness.trackA.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackB.stop).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  test("重复读取电平时复用输入和输出缓冲区", async () => {
    const harness = createEngineHarness();
    await harness.engine.start(harness.stream, DEFAULT_SETTINGS, {
      denoiseEnabled: true,
    });

    expect(harness.engine.readLevels()).toEqual({ input: 0, output: 0 });
    expect(harness.engine.readLevels()).toEqual({ input: 0, output: 0 });

    expect(harness.inputBuffers).toHaveLength(2);
    expect(harness.outputBuffers).toHaveLength(2);
    expect(harness.inputBuffers[0]).toBe(harness.inputBuffers[1]);
    expect(harness.outputBuffers[0]).toBe(harness.outputBuffers[1]);
  });
});
