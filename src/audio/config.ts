export type AudioSettings = {
  volume: number;
  clarity: number;
  compression: number;
  lowCut: number;
  limit: number;
};

export const DEFAULT_SETTINGS: AudioSettings = {
  volume: 3,
  clarity: 40,
  compression: 40,
  lowCut: 100,
  limit: -8,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const dbToGain = (db: number) => Math.pow(10, db / 20);

export function createPeakCeilingCurve(
  limitDb: number,
  size = 65_537,
): Float32Array<ArrayBuffer> {
  const curveSize = Number.isFinite(size)
    ? Math.max(2, Math.floor(size))
    : 65_537;
  const ceiling = dbToGain(clamp(limitDb, -24, -1));
  // Keep the stored Float32 value at or below the requested double ceiling.
  const sampleCeiling = Math.fround(ceiling * (1 - 2 ** -23));
  const curve = new Float32Array(curveSize);

  for (let index = 0; index < curveSize; index += 1) {
    const input = -1 + (2 * index) / (curveSize - 1);
    curve[index] = clamp(input, -sampleCeiling, sampleCeiling);
  }

  return curve;
}

export function createCaptureConstraints(
  deviceId?: string,
): MediaTrackConstraints {
  return {
    channelCount: 1,
    sampleRate: 48000,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export function mapDspSettings(settings: AudioSettings) {
  const volumeDb = clamp(settings.volume, -12, 12);
  const clarity = clamp(settings.clarity, 0, 100);
  const compression = clamp(settings.compression, 0, 100);

  return {
    volumeDb,
    outputGain: dbToGain(volumeDb),
    lowCutHz: clamp(settings.lowCut, 40, 240),
    lowShelfGain: -clarity / 25,
    presenceGain: (clarity - 50) / 8,
    brightnessGain: Math.max(0, (clarity - 50) / 32),
    compressorThreshold: -18 - compression * 0.18,
    compressorRatio: 1 + compression * 0.04,
    limiterThreshold: clamp(settings.limit, -24, -1),
  };
}
