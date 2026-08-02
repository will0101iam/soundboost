import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Headphones, Mic, Play, Square, Volume2, Waves } from "lucide-react";
import {
  createCaptureConstraints,
  DEFAULT_SETTINGS,
  type AudioSettings,
} from "./audio/config";
import {
  groupAudioDevices,
  mergeAudioOutputDevice,
  normalizeDeviceSelection,
  normalizeOutputDeviceSelection,
  selectAudioOutputDevice,
  shouldRestartForDeviceChange,
  supportsAudioOutputSelection,
  toOutputDeviceErrorMessage,
  type AudioDeviceOption,
} from "./audio/devices";
import {
  runLatestDeviceRefresh,
  runLatestOutputSelection,
} from "./audio/deviceRefresh";
import {
  type EngineState,
  RealtimeAudioEngine,
  toAudioErrorMessage,
} from "./audio/engine";
import { OperationGate } from "./audio/operationGate";
import { runGuardedStart } from "./audio/startOperation";
import "./styles.css";

const STATUS_TEXT: Record<EngineState, string> = {
  idle: "未开始",
  "loading-model": "加载降噪模型",
  starting: "启动音频",
  running: "实时扩音中",
  stopping: "停止中",
  error: "启动失败",
};

function supportsOutputDeviceSelection() {
  return (
    typeof AudioContext !== "undefined" &&
    "setSinkId" in AudioContext.prototype
  );
}

function App() {
  const engine = useRef<RealtimeAudioEngine | null>(null);
  const operationGate = useRef<OperationGate | null>(null);
  const deviceRefreshGate = useRef<OperationGate | null>(null);
  const outputSelectionGate = useRef<OperationGate | null>(null);
  const mounted = useRef(true);
  const raf = useRef<number | null>(null);
  const vadTimer = useRef<number | null>(null);
  const lastMeterUpdate = useRef(-50);
  const devicesReady = useRef(false);
  const runStateRef = useRef<EngineState>("idle");
  const selectedInputRef = useRef("");
  const selectedOutputRef = useRef("");
  const denoiseEnabledRef = useRef(true);
  const [runState, setRunState] = useState<EngineState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [deviceNotice, setDeviceNotice] = useState(
    "首次开始后显示可用设备。",
  );
  const [deviceError, setDeviceError] = useState("");
  const [selectingOutput, setSelectingOutput] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedInput, setSelectedInput] = useState("");
  const [selectedOutput, setSelectedOutput] = useState("");
  const [denoiseEnabled, setDenoiseEnabled] = useState(true);
  const [vadProbability, setVadProbability] = useState(0);
  const [outputRoutingSupported] = useState(supportsOutputDeviceSelection);
  const [outputSelectionSupported] = useState(() =>
    supportsAudioOutputSelection(navigator.mediaDevices),
  );
  const [volume, setVolume] = useState(DEFAULT_SETTINGS.volume);
  const [clarity, setClarity] = useState(DEFAULT_SETTINGS.clarity);
  const [compression, setCompression] = useState(
    DEFAULT_SETTINGS.compression,
  );
  const [lowCut, setLowCut] = useState(DEFAULT_SETTINGS.lowCut);
  const [limit, setLimit] = useState(DEFAULT_SETTINGS.limit);

  if (engine.current === null) {
    engine.current = new RealtimeAudioEngine();
  }
  if (operationGate.current === null) {
    operationGate.current = new OperationGate();
  }
  if (deviceRefreshGate.current === null) {
    deviceRefreshGate.current = new OperationGate();
  }
  if (outputSelectionGate.current === null) {
    outputSelectionGate.current = new OperationGate();
  }

  selectedInputRef.current = selectedInput;
  selectedOutputRef.current = selectedOutput;
  denoiseEnabledRef.current = denoiseEnabled;

  const isRunning = runState === "running";
  const canStart = runState === "idle" || runState === "error";
  const canStop =
    runState === "loading-model" ||
    runState === "starting" ||
    runState === "running";
  const statusText =
    runState === "error" ? errorMessage : STATUS_TEXT[runState];
  const startButtonText =
    runState === "loading-model" || runState === "starting"
      ? "启动中"
      : isRunning
        ? "扩音中"
        : "开始";
  const voiceDetected = vadProbability >= 0.55;

  const settings: AudioSettings = useMemo(
    () => ({ volume, clarity, compression, lowCut, limit }),
    [volume, clarity, compression, lowCut, limit],
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    engine.current?.applySettings(settings);
  }, [settings]);

  const updateRunState = useCallback((nextState: EngineState) => {
    runStateRef.current = nextState;
    setRunState(nextState);
  }, []);

  const cancelMeters = useCallback(() => {
    if (raf.current === null) return;
    cancelAnimationFrame(raf.current);
    raf.current = null;
    lastMeterUpdate.current = -50;
  }, []);

  const drawMeters = useCallback((timestamp: number) => {
    if (timestamp - lastMeterUpdate.current >= 50) {
      const levels = engine.current?.readLevels() ?? { input: 0, output: 0 };
      setInputLevel(levels.input);
      setOutputLevel(levels.output);
      lastMeterUpdate.current = timestamp;
    }
    raf.current = requestAnimationFrame(drawMeters);
  }, []);

  const cancelVad = useCallback(() => {
    if (vadTimer.current === null) return;
    window.clearInterval(vadTimer.current);
    vadTimer.current = null;
  }, []);

  const cleanupAudio = useCallback(async () => {
    cancelMeters();
    cancelVad();
    await engine.current?.stop();
    cancelMeters();
    cancelVad();
  }, [cancelMeters, cancelVad]);

  const applyDevices = useCallback((
    devices: MediaDeviceInfo[],
    preferredInputId = selectedInputRef.current,
  ) => {
    const grouped = groupAudioDevices(devices);
    const inputId = normalizeDeviceSelection(
      preferredInputId,
      grouped.inputs,
    );
    const outputId = normalizeOutputDeviceSelection(
      selectedOutputRef.current,
      grouped.outputs,
    );
    const result = {
      inputId,
      outputId,
      inputChanged: inputId !== selectedInputRef.current,
      outputChanged: outputId !== selectedOutputRef.current,
    };

    selectedInputRef.current = inputId;
    selectedOutputRef.current = outputId;
    setSelectedInput(inputId);
    setSelectedOutput(outputId);
    setInputDevices(grouped.inputs);
    setOutputDevices(grouped.outputs);
    setDeviceNotice(
      grouped.inputs.length > 0
        ? "设备名称来自浏览器当前授权结果。"
        : "未检测到可用麦克风。",
    );
    return result;
  }, []);

  const refreshDevices = useCallback((
    onApplied?: (changes: ReturnType<typeof applyDevices>) => void,
  ) => {
    const gate = deviceRefreshGate.current;
    if (!devicesReady.current || !gate) {
      return Promise.resolve("stale" as const);
    }

    return runLatestDeviceRefresh({
      gate,
      load: () => navigator.mediaDevices.enumerateDevices(),
      apply: (devices) => {
        onApplied?.(applyDevices(devices));
      },
      fail: () => {
        setDeviceNotice("设备列表刷新失败，请重新选择设备。");
      },
    });
  }, [applyDevices]);

  const startWithDevices = useCallback(
    async (
      inputDeviceId = selectedInputRef.current,
      outputDeviceId = selectedOutputRef.current,
    ) => {
      const gate = operationGate.current;
      if (!gate) return;
      setErrorMessage("");
      setDeviceError("");
      setInputLevel(0);
      setOutputLevel(0);
      setVadProbability(0);
      updateRunState("starting");

      try {
        const result = await runGuardedStart({
          gate,
          prepare: cleanupAudio,
          constraints: {
            audio: createCaptureConstraints(inputDeviceId || undefined),
          },
          getUserMedia: (constraints) =>
            navigator.mediaDevices.getUserMedia(constraints),
          onStreamAcquired: async (stream, isCurrent) => {
            try {
              const devices = await navigator.mediaDevices.enumerateDevices();
              if (!isCurrent()) return;
              const actualInputId =
                stream.getAudioTracks()[0]?.getSettings().deviceId ??
                inputDeviceId;
              devicesReady.current = true;
              applyDevices(devices, actualInputId);
            } catch {
              if (isCurrent()) {
                devicesReady.current = true;
                setDeviceNotice(
                  "无法读取设备名称，仍会继续启动实时扩音。",
                );
              }
            }
          },
          startEngine: async (stream) => {
            updateRunState("loading-model");
            const activeEngine = engine.current;
            if (!activeEngine) {
              stream.getTracks().forEach((track) => track.stop());
              throw new Error("实时扩音引擎不可用。");
            }
            await activeEngine.start(stream, settingsRef.current, {
              denoiseEnabled: denoiseEnabledRef.current,
              outputDeviceId:
                outputRoutingSupported && outputDeviceId
                  ? outputDeviceId
                  : undefined,
              onVad: (probability) => {
                setVadProbability(Math.min(1, Math.max(0, probability)));
              },
              onTrackEnded: () => {
                if (!mounted.current) return;
                operationGate.current?.invalidate();
                cancelMeters();
                cancelVad();
                setInputLevel(0);
                setOutputLevel(0);
                setVadProbability(0);
                setErrorMessage("麦克风已断开，请重新开始");
                updateRunState("error");
              },
            });
          },
        });
        if (result === "stale") return;

        engine.current?.applySettings(settingsRef.current);
        engine.current?.setDenoiseEnabled(denoiseEnabledRef.current);
        setErrorMessage("");
        updateRunState("running");
        cancelMeters();
        raf.current = requestAnimationFrame(drawMeters);
      } catch (reason) {
        setErrorMessage(toAudioErrorMessage(reason));
        updateRunState("error");
      }
    },
    [
      cancelMeters,
      cancelVad,
      cleanupAudio,
      drawMeters,
      applyDevices,
      outputRoutingSupported,
      updateRunState,
    ],
  );

  const start = useCallback(() => {
    outputSelectionGate.current?.invalidate();
    setSelectingOutput(false);
    setDeviceError("");
    void startWithDevices();
  }, [startWithDevices]);

  const stop = useCallback(async () => {
    const gate = operationGate.current;
    const token = gate?.begin();
    outputSelectionGate.current?.invalidate();
    setSelectingOutput(false);
    setDeviceError("");
    updateRunState("stopping");
    await cleanupAudio();
    if (gate && token !== undefined && !gate.isCurrent(token)) return;
    setInputLevel(0);
    setOutputLevel(0);
    setVadProbability(0);
    setErrorMessage("");
    updateRunState("idle");
  }, [cleanupAudio, updateRunState]);

  const handleInputChange = useCallback((
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextInput = event.currentTarget.value;
    deviceRefreshGate.current?.invalidate();
    selectedInputRef.current = nextInput;
    setSelectedInput(nextInput);
    if (shouldRestartForDeviceChange(runStateRef.current)) {
      void startWithDevices(nextInput, selectedOutputRef.current);
    }
  }, [startWithDevices]);

  const handleOutputChange = useCallback((
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextOutput = event.currentTarget.value;
    deviceRefreshGate.current?.invalidate();
    outputSelectionGate.current?.invalidate();
    setSelectingOutput(false);
    setDeviceError("");
    selectedOutputRef.current = nextOutput;
    setSelectedOutput(nextOutput);
    if (shouldRestartForDeviceChange(runStateRef.current)) {
      void startWithDevices(selectedInputRef.current, nextOutput);
    }
  }, [startWithDevices]);

  const handleSelectAudioOutput = useCallback(async () => {
    const refreshGate = deviceRefreshGate.current;
    const selectionGate = outputSelectionGate.current;
    if (!refreshGate || !selectionGate) return;

    setSelectingOutput(true);
    setDeviceError("");

    const result = await runLatestOutputSelection({
      refreshGate,
      selectionGate,
      select: async () => {
        const selection = await selectAudioOutputDevice(
          navigator.mediaDevices,
        );
        if (!selection.supported) {
          throw new Error(
            "当前浏览器不支持输出设备授权，请从列表或系统设置中选择。",
          );
        }
        return selection.device;
      },
      apply: (selectedDevice) => {
        const nextOutput = selectedDevice.deviceId;
        setOutputDevices((devices) =>
          mergeAudioOutputDevice(devices, selectedDevice),
        );
        selectedOutputRef.current = nextOutput;
        setSelectedOutput(nextOutput);
        setDeviceError("");
        setDeviceNotice(
          `已授权输出设备：${selectedDevice.label || "已选择设备"}`,
        );

        if (shouldRestartForDeviceChange(runStateRef.current)) {
          void startWithDevices(selectedInputRef.current, nextOutput);
        }
      },
      fail: (reason) => {
        setDeviceError(
          reason instanceof Error &&
            reason.message.startsWith("当前浏览器不支持")
            ? reason.message
            : toOutputDeviceErrorMessage(reason),
        );
      },
    });

    if (result !== "stale") {
      setSelectingOutput(false);
    }
  }, [startWithDevices]);

  const handleDenoiseChange = useCallback((
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const enabled = event.currentTarget.checked;
    denoiseEnabledRef.current = enabled;
    setDenoiseEnabled(enabled);
    engine.current?.setDenoiseEnabled(enabled);
  }, []);

  useEffect(() => {
    cancelVad();
    if (runState !== "running") return;

    engine.current?.requestVad();
    vadTimer.current = window.setInterval(() => {
      engine.current?.requestVad();
    }, 250);
    return cancelVad;
  }, [cancelVad, runState]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      if (!devicesReady.current) return;
      void refreshDevices(
        (changes) => {
          const { inputId, outputId, inputChanged, outputChanged } =
            changes;
          if (
            shouldRestartForDeviceChange(runStateRef.current) &&
            (inputChanged || (outputRoutingSupported && outputChanged))
          ) {
            void startWithDevices(inputId, outputId);
          }
        },
      );
    };

    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      deviceRefreshGate.current?.invalidate();
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [outputRoutingSupported, refreshDevices, startWithDevices]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationGate.current?.invalidate();
      deviceRefreshGate.current?.invalidate();
      outputSelectionGate.current?.invalidate();
      cancelMeters();
      cancelVad();
      void engine.current?.stop();
    };
  }, [cancelMeters, cancelVad]);

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Local Audio Lab</p>
            <h1>声音增强测试</h1>
          </div>
          <div
            className={`status ${isRunning ? "live" : ""} ${runState === "error" ? "error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {statusText}
          </div>
        </div>

        <div className="control-surface">
          <section className="listen-panel">
            <div className="listen-orb">
              <Waves size={54} strokeWidth={1.6} />
              <div className="pulse" style={{ transform: `scale(${1 + outputLevel * 0.35})` }} />
            </div>
            <div className="primary-actions">
              <button className="primary" onClick={start} disabled={!canStart}>
                <Play size={19} />
                {startButtonText}
              </button>
              <button className="secondary" onClick={stop} disabled={!canStop}>
                <Square size={18} />
                停止
              </button>
            </div>
            <div className="device-note">
              <Headphones size={18} />
              <span>数字峰值受限，不代表耳机声压安全</span>
            </div>
          </section>

          <section className="meters">
            <Meter icon={<Mic size={18} />} label="输入" value={inputLevel} />
            <Meter icon={<Volume2 size={18} />} label="输出" value={outputLevel} hot={outputLevel > 0.86} />
          </section>

          <section className="devices-panel" aria-label="音频设备与降噪">
            <div className="device-grid">
              <label className="device-field">
                <span>输入设备</span>
                <select
                  value={selectedInput}
                  onChange={handleInputChange}
                  disabled={inputDevices.length === 0 || runState === "stopping"}
                >
                  {inputDevices.length === 0 ? (
                    <option value="">授权后显示麦克风</option>
                  ) : (
                    inputDevices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))
                  )}
                </select>
              </label>

              {outputRoutingSupported ? (
                <div className="device-field">
                  <label htmlFor="output-device">输出设备</label>
                  <select
                    id="output-device"
                    value={selectedOutput}
                    onChange={handleOutputChange}
                    disabled={runState === "stopping"}
                  >
                    <option value="">
                      系统默认输出（由系统控制）
                    </option>
                    {outputDevices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                  {outputSelectionSupported ? (
                    <button
                      type="button"
                      className="output-select-button"
                      onClick={handleSelectAudioOutput}
                      disabled={selectingOutput || runState === "stopping"}
                    >
                      {selectingOutput ? "等待选择" : "选择蓝牙输出"}
                    </button>
                  ) : (
                    <small>
                      浏览器未提供输出授权按钮；列表中的设备可能仍需在系统中授权。
                    </small>
                  )}
                </div>
              ) : (
                <div className="device-field route-fallback">
                  <span>输出设备</span>
                  <strong>由系统控制</strong>
                  <small>请在系统设置中选择蓝牙耳机。</small>
                </div>
              )}
            </div>

            <p className="device-hint">{deviceNotice}</p>
            {deviceError ? (
              <p className="device-error" role="alert">
                {deviceError}
              </p>
            ) : null}

            <div className="signal-controls">
              <label className="denoise-control">
                <input
                  type="checkbox"
                  checked={denoiseEnabled}
                  onChange={handleDenoiseChange}
                />
                <span>
                  <strong>RNNoise 降噪</strong>
                  <small>关闭可进行原声 A/B 对比，不改变增益。</small>
                </span>
              </label>

              <div className={`voice-state ${isRunning && voiceDetected ? "detected" : ""}`}>
                <span className="voice-dot" aria-hidden="true" />
                <span>
                  <strong>
                    {isRunning
                      ? voiceDetected
                        ? "检测到人声"
                        : "等待人声"
                      : "人声检测待机"}
                  </strong>
                  <small>
                    {isRunning
                      ? `人声概率 ${Math.round(vadProbability * 100)}%`
                      : "开始实时扩音后显示检测结果。"}
                  </small>
                </span>
              </div>
            </div>
          </section>

          <section className="sliders">
            <Slider
              label="音量"
              value={volume}
              min={-12}
              max={12}
              step={1}
              valueLabel={`${volume} dB`}
              onChange={setVolume}
            />
            <Slider
              label="清晰度"
              value={clarity}
              min={0}
              max={100}
              step={1}
              valueLabel={`${clarity}%`}
              onChange={setClarity}
            />
            <Slider
              label="压缩"
              value={compression}
              min={0}
              max={100}
              step={1}
              valueLabel={`${compression}%`}
              onChange={setCompression}
            />
            <Slider
              label="低频过滤"
              value={lowCut}
              min={40}
              max={240}
              step={10}
              valueLabel={`${lowCut} Hz`}
              onChange={setLowCut}
            />
            <Slider
              label="数字峰值上限"
              value={limit}
              min={-24}
              max={-1}
              step={1}
              valueLabel={`${limit} dBFS`}
              onChange={setLimit}
            />
          </section>

          <section className="presets">
            <button onClick={() => { setVolume(0); setClarity(30); setCompression(20); setLimit(-10); }}>
              自然
            </button>
            <button onClick={() => { setVolume(9); setClarity(55); setCompression(55); setLimit(-8); }}>
              明显变响
            </button>
            <button onClick={() => { setVolume(10); setClarity(75); setCompression(75); setLimit(-6); }}>
              人声突出
            </button>
            <button onClick={() => { setVolume(5); setClarity(65); setCompression(85); setLimit(-14); }}>
              低峰值
            </button>
          </section>
        </div>

        <footer>
          <Volume2 size={16} />
          <span>仅限制数字峰值，不代表耳机声压安全；请从低音量开始。</span>
        </footer>
      </section>
    </main>
  );
}

function Meter({ icon, label, value, hot = false }: { icon: React.ReactNode; label: string; value: number; hot?: boolean }) {
  return (
    <div className={`meter ${hot ? "hot" : ""}`}>
      <div className="meter-head">
        {icon}
        <span>{label}</span>
        <strong>{Math.round(value * 100)}%</strong>
      </div>
      <div className="meter-track">
        <div style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <strong>{valueLabel}</strong>
    </label>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
