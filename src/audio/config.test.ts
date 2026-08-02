import { describe, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  createPeakCeilingCurve,
  createCaptureConstraints,
  dbToGain,
  mapDspSettings,
} from "./config";

describe("createCaptureConstraints", () => {
  test("为 RNNoise 请求 48 kHz 单声道且不重复启用浏览器降噪", () => {
    expect(createCaptureConstraints()).toEqual({
      channelCount: 1,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  test("在选择输入设备时使用精确 deviceId", () => {
    expect(createCaptureConstraints("bluetooth-mic")).toMatchObject({
      deviceId: { exact: "bluetooth-mic" },
    });
  });
});

describe("mapDspSettings", () => {
  test("默认增益和压缩保持在安全范围", () => {
    const mapped = mapDspSettings(DEFAULT_SETTINGS);

    expect(DEFAULT_SETTINGS.volume).toBe(3);
    expect(mapped.outputGain).toBeCloseTo(1.4125, 3);
    expect(mapped.compressorThreshold).toBeGreaterThanOrEqual(-30);
    expect(mapped.compressorRatio).toBeLessThanOrEqual(4);
  });

  test("钳制越界设置", () => {
    const mapped = mapDspSettings({
      volume: 99,
      clarity: 999,
      compression: 999,
      lowCut: 999,
      limit: 0,
    });

    expect(mapped.volumeDb).toBe(12);
    expect(mapped.lowCutHz).toBe(240);
    expect(mapped.limiterThreshold).toBe(-1);
    expect(mapped.lowShelfGain).toBe(-4);
    expect(mapped.presenceGain).toBe(6.25);
    expect(mapped.brightnessGain).toBe(1.5625);
    expect(mapped.compressorThreshold).toBe(-36);
    expect(mapped.compressorRatio).toBe(5);
  });

  test("将负数清晰度和压缩映射到安全下界", () => {
    const mapped = mapDspSettings({
      ...DEFAULT_SETTINGS,
      clarity: -1,
      compression: -1,
    });

    expect(mapped.lowShelfGain).toBeCloseTo(0);
    expect(mapped.presenceGain).toBe(-6.25);
    expect(mapped.brightnessGain).toBe(0);
    expect(mapped.compressorThreshold).toBe(-18);
    expect(mapped.compressorRatio).toBe(1);
  });
});

describe("createPeakCeilingCurve", () => {
  test("将任意样本限制在配置的数字峰值内", () => {
    const ceiling = dbToGain(-8);
    const curve = createPeakCeilingCurve(-8, 1001);

    expect(curve).toHaveLength(1001);
    expect(Math.max(...Array.from(curve, Math.abs))).toBeLessThanOrEqual(
      ceiling,
    );
    expect(curve[0]).toBeCloseTo(-ceiling, 6);
    expect(curve.at(-1)).toBeCloseTo(ceiling, 6);
  });

  test("阈值内保持线性且曲线正负对称", () => {
    const curve = createPeakCeilingCurve(-6, 101);

    for (let index = 0; index < curve.length; index += 1) {
      expect(curve[index]).toBeCloseTo(-curve[curve.length - 1 - index], 6);
    }
    expect(curve[50]).toBeCloseTo(0, 6);
    expect(curve[70]).toBeCloseTo(0.4, 6);
  });

  test("越界上限沿用配置的 -24 dB 到 -1 dB 钳制语义", () => {
    const tooHigh = createPeakCeilingCurve(10, 101);
    const tooLow = createPeakCeilingCurve(-100, 101);

    expect(tooHigh.at(-1)).toBeCloseTo(dbToGain(-1), 6);
    expect(tooLow.at(-1)).toBeCloseTo(dbToGain(-24), 6);
  });
});
