import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Headphones, Mic, Play, Shield, Square, Volume2, Waves } from "lucide-react";
import "./styles.css";

type AudioGraph = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  highpass: BiquadFilterNode;
  lowShelf: BiquadFilterNode;
  presence: BiquadFilterNode;
  brightness: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  outputGain: GainNode;
  limiter: DynamicsCompressorNode;
  inputAnalyser: AnalyserNode;
  outputAnalyser: AnalyserNode;
};

const dbToGain = (db: number) => Math.pow(10, db / 20);

function createGraph(stream: MediaStream): AudioGraph {
  const context = new AudioContext({ latencyHint: "interactive" });
  const source = context.createMediaStreamSource(stream);
  const inputAnalyser = context.createAnalyser();
  const highpass = context.createBiquadFilter();
  const lowShelf = context.createBiquadFilter();
  const presence = context.createBiquadFilter();
  const brightness = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const outputGain = context.createGain();
  const limiter = context.createDynamicsCompressor();
  const outputAnalyser = context.createAnalyser();

  inputAnalyser.fftSize = 1024;
  outputAnalyser.fftSize = 1024;

  highpass.type = "highpass";
  highpass.frequency.value = 90;
  highpass.Q.value = 0.7;

  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 280;
  lowShelf.gain.value = -3;

  presence.type = "peaking";
  presence.frequency.value = 2200;
  presence.Q.value = 1.0;
  presence.gain.value = 4;

  brightness.type = "highshelf";
  brightness.frequency.value = 4200;
  brightness.gain.value = 2;

  compressor.threshold.value = -34;
  compressor.knee.value = 20;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;

  outputGain.gain.value = dbToGain(6);

  limiter.threshold.value = -8;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;

  source.connect(inputAnalyser);
  source
    .connect(highpass)
    .connect(lowShelf)
    .connect(presence)
    .connect(brightness)
    .connect(compressor)
    .connect(outputGain)
    .connect(limiter)
    .connect(outputAnalyser)
    .connect(context.destination);

  return {
    context,
    stream,
    source,
    highpass,
    lowShelf,
    presence,
    brightness,
    compressor,
    outputGain,
    limiter,
    inputAnalyser,
    outputAnalyser,
  };
}

function meterLevel(analyser: AnalyserNode | null) {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const value of data) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 5);
}

function App() {
  const graph = useRef<AudioGraph | null>(null);
  const raf = useRef<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [volume, setVolume] = useState(6);
  const [clarity, setClarity] = useState(45);
  const [compression, setCompression] = useState(55);
  const [lowCut, setLowCut] = useState(90);
  const [limit, setLimit] = useState(-8);

  const statusText = useMemo(() => {
    if (error) return error;
    return isRunning ? "正在监听" : "未开始";
  }, [error, isRunning]);

  const applySettings = () => {
    const g = graph.current;
    if (!g) return;
    const now = g.context.currentTime;
    const clarityGain = (clarity - 50) / 5;
    const compressionRatio = 1 + (compression / 100) * 11;
    const threshold = -18 - (compression / 100) * 28;

    g.highpass.frequency.setTargetAtTime(lowCut, now, 0.025);
    g.lowShelf.gain.setTargetAtTime(Math.min(0, -clarity / 18), now, 0.025);
    g.presence.gain.setTargetAtTime(clarityGain, now, 0.025);
    g.brightness.gain.setTargetAtTime(Math.max(0, clarityGain * 0.35), now, 0.025);
    g.compressor.threshold.setTargetAtTime(threshold, now, 0.025);
    g.compressor.ratio.setTargetAtTime(compressionRatio, now, 0.025);
    g.outputGain.gain.setTargetAtTime(dbToGain(volume), now, 0.025);
    g.limiter.threshold.setTargetAtTime(limit, now, 0.025);
  };

  useEffect(applySettings, [volume, clarity, compression, lowCut, limit]);

  const drawMeters = () => {
    setInputLevel(meterLevel(graph.current?.inputAnalyser ?? null));
    setOutputLevel(meterLevel(graph.current?.outputAnalyser ?? null));
    raf.current = requestAnimationFrame(drawMeters);
  };

  const stop = async () => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    const g = graph.current;
    graph.current = null;
    if (g) {
      g.stream.getTracks().forEach((track) => track.stop());
      await g.context.close();
    }
    setInputLevel(0);
    setOutputLevel(0);
    setIsRunning(false);
  };

  const start = async () => {
    setError("");
    try {
      await stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      graph.current = createGraph(stream);
      applySettings();
      await graph.current.context.resume();
      setIsRunning(true);
      drawMeters();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "麦克风不可用");
      setIsRunning(false);
    }
  };

  useEffect(() => {
    return () => {
      void stop();
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Local Audio Lab</p>
            <h1>声音增强测试</h1>
          </div>
          <div className={`status ${isRunning ? "live" : ""}`}>{statusText}</div>
        </div>

        <div className="control-surface">
          <section className="listen-panel">
            <div className="listen-orb">
              <Waves size={54} strokeWidth={1.6} />
              <div className="pulse" style={{ transform: `scale(${1 + outputLevel * 0.35})` }} />
            </div>
            <div className="primary-actions">
              <button className="primary" onClick={start}>
                <Play size={19} />
                开始
              </button>
              <button className="secondary" onClick={stop} disabled={!isRunning}>
                <Square size={18} />
                停止
              </button>
            </div>
            <div className="device-note">
              <Headphones size={18} />
              <span>建议使用耳机测试</span>
            </div>
          </section>

          <section className="meters">
            <Meter icon={<Mic size={18} />} label="输入" value={inputLevel} />
            <Meter icon={<Volume2 size={18} />} label="输出" value={outputLevel} hot={outputLevel > 0.86} />
          </section>

          <section className="sliders">
            <Slider
              label="音量"
              value={volume}
              min={-12}
              max={24}
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
              label="保护上限"
              value={limit}
              min={-24}
              max={-1}
              step={1}
              valueLabel={`${limit} dB`}
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
            <button onClick={() => { setVolume(13); setClarity(75); setCompression(75); setLimit(-6); }}>
              人声突出
            </button>
            <button onClick={() => { setVolume(5); setClarity(65); setCompression(85); setLimit(-14); }}>
              舒适保护
            </button>
          </section>
        </div>

        <footer>
          <Shield size={16} />
          <span>输出经过限制器；第一次测试请从低音量开始。</span>
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
