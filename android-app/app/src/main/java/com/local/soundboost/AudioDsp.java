package com.local.soundboost;

final class AudioDsp {
    private final Biquad highpass;
    private final Biquad presence;
    private final Biquad brightness;

    private volatile int targetVolumeDb = 3;
    private volatile int targetClarity = 55;
    private volatile int targetCompression = 35;
    private volatile int targetLowCutHz = 90;
    private volatile int targetLimitDb = -8;

    private int appliedVolumeDb = Integer.MIN_VALUE;
    private int appliedClarity = Integer.MIN_VALUE;
    private int appliedCompression = Integer.MIN_VALUE;
    private int appliedLowCutHz = Integer.MIN_VALUE;
    private int appliedLimitDb = Integer.MIN_VALUE;

    private float volumeGain;
    private float compressionAmount;
    private float ceiling;

    AudioDsp(int sampleRate) {
        if (sampleRate <= 0) {
            throw new IllegalArgumentException("sampleRate must be positive");
        }
        highpass = Biquad.highpass(sampleRate, targetLowCutHz, 0.7f);
        presence = Biquad.peaking(sampleRate, 2200.0f, 1.0f, 0.0f);
        brightness = Biquad.highShelf(sampleRate, 4200.0f, 0.0f);
        applySettingsIfNeeded();
    }

    void setSettings(
            int volumeDb,
            int clarity,
            int compression,
            int lowCutHz,
            int limitDb
    ) {
        targetVolumeDb = clamp(volumeDb, -12, 12);
        targetClarity = clamp(clarity, 0, 100);
        targetCompression = clamp(compression, 0, 100);
        targetLowCutHz = clamp(lowCutHz, 40, 240);
        targetLimitDb = clamp(limitDb, -24, -1);
    }

    short process(short input) {
        applySettingsIfNeeded();
        float sample = input / 32768.0f;
        sample = highpass.process(sample);
        sample = presence.process(sample);
        sample = brightness.process(sample);
        sample = compress(sample, compressionAmount);
        sample = limit(sample * volumeGain, ceiling);
        return pcm16(sample);
    }

    static float compress(float sample, float amount) {
        float normalizedAmount = clamp(amount, 0.0f, 1.0f);
        float magnitude = Math.abs(sample);
        float threshold = 0.12f + (1.0f - normalizedAmount) * 0.38f;
        if (magnitude <= threshold) {
            return sample;
        }
        float ratio = 1.0f + normalizedAmount * 5.0f;
        float compressed = threshold + (magnitude - threshold) / ratio;
        return Math.copySign(compressed, sample);
    }

    static float limit(float sample, float ceiling) {
        float safeCeiling = clamp(ceiling, 0.0f, 1.0f);
        return clamp(sample, -safeCeiling, safeCeiling);
    }

    static float volumeGainFor(int volumeDb) {
        return dbToGain(clamp(volumeDb, -12, 12));
    }

    static float dbToGain(float db) {
        return (float) Math.pow(10.0, db / 20.0);
    }

    private void applySettingsIfNeeded() {
        int volumeDb = targetVolumeDb;
        int clarity = targetClarity;
        int compression = targetCompression;
        int lowCutHz = targetLowCutHz;
        int limitDb = targetLimitDb;
        if (volumeDb == appliedVolumeDb
                && clarity == appliedClarity
                && compression == appliedCompression
                && lowCutHz == appliedLowCutHz
                && limitDb == appliedLimitDb) {
            return;
        }

        highpass.updateHighpass(lowCutHz, 0.7f);
        presence.updatePeaking(2200.0f, 1.0f, (clarity - 50.0f) * 0.08f);
        brightness.updateHighShelf(4200.0f, Math.max(0.0f, (clarity - 50.0f) * 0.04f));
        volumeGain = volumeGainFor(volumeDb);
        compressionAmount = compression / 100.0f;
        ceiling = dbToGain(limitDb);

        appliedVolumeDb = volumeDb;
        appliedClarity = clarity;
        appliedCompression = compression;
        appliedLowCutHz = lowCutHz;
        appliedLimitDb = limitDb;
    }

    private static short pcm16(float sample) {
        if (Float.isNaN(sample) || Float.isInfinite(sample)) {
            return 0;
        }
        int pcm = Math.round(sample * 32767.0f);
        return (short) clamp(pcm, Short.MIN_VALUE, Short.MAX_VALUE);
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    private static float clamp(float value, float minimum, float maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    private static final class Biquad {
        private final float sampleRate;
        private float b0;
        private float b1;
        private float b2;
        private float a1;
        private float a2;
        private float z1;
        private float z2;

        private Biquad(float sampleRate) {
            this.sampleRate = sampleRate;
        }

        static Biquad highpass(float sampleRate, float frequency, float q) {
            Biquad filter = new Biquad(sampleRate);
            filter.updateHighpass(frequency, q);
            return filter;
        }

        static Biquad peaking(
                float sampleRate,
                float frequency,
                float q,
                float gainDb
        ) {
            Biquad filter = new Biquad(sampleRate);
            filter.updatePeaking(frequency, q, gainDb);
            return filter;
        }

        static Biquad highShelf(float sampleRate, float frequency, float gainDb) {
            Biquad filter = new Biquad(sampleRate);
            filter.updateHighShelf(frequency, gainDb);
            return filter;
        }

        void updateHighpass(float frequency, float q) {
            float omega = (float) (2.0 * Math.PI * frequency / sampleRate);
            float cosine = (float) Math.cos(omega);
            float sine = (float) Math.sin(omega);
            float alpha = sine / (2.0f * q);
            set(
                    (1.0f + cosine) / 2.0f,
                    -(1.0f + cosine),
                    (1.0f + cosine) / 2.0f,
                    1.0f + alpha,
                    -2.0f * cosine,
                    1.0f - alpha
            );
        }

        void updatePeaking(float frequency, float q, float gainDb) {
            float a = (float) Math.pow(10.0, gainDb / 40.0);
            float omega = (float) (2.0 * Math.PI * frequency / sampleRate);
            float cosine = (float) Math.cos(omega);
            float sine = (float) Math.sin(omega);
            float alpha = sine / (2.0f * q);
            set(
                    1.0f + alpha * a,
                    -2.0f * cosine,
                    1.0f - alpha * a,
                    1.0f + alpha / a,
                    -2.0f * cosine,
                    1.0f - alpha / a
            );
        }

        void updateHighShelf(float frequency, float gainDb) {
            float a = (float) Math.pow(10.0, gainDb / 40.0);
            float omega = (float) (2.0 * Math.PI * frequency / sampleRate);
            float cosine = (float) Math.cos(omega);
            float sine = (float) Math.sin(omega);
            float beta = (float) Math.sqrt(a) / 0.707f;
            set(
                    a * ((a + 1.0f) + (a - 1.0f) * cosine + beta * sine),
                    -2.0f * a * ((a - 1.0f) + (a + 1.0f) * cosine),
                    a * ((a + 1.0f) + (a - 1.0f) * cosine - beta * sine),
                    (a + 1.0f) - (a - 1.0f) * cosine + beta * sine,
                    2.0f * ((a - 1.0f) - (a + 1.0f) * cosine),
                    (a + 1.0f) - (a - 1.0f) * cosine - beta * sine
            );
        }

        float process(float input) {
            float output = input * b0 + z1;
            z1 = input * b1 + z2 - a1 * output;
            z2 = input * b2 - a2 * output;
            return output;
        }

        private void set(
                float coefficientB0,
                float coefficientB1,
                float coefficientB2,
                float coefficientA0,
                float coefficientA1,
                float coefficientA2
        ) {
            b0 = coefficientB0 / coefficientA0;
            b1 = coefficientB1 / coefficientA0;
            b2 = coefficientB2 / coefficientA0;
            a1 = coefficientA1 / coefficientA0;
            a2 = coefficientA2 / coefficientA0;
        }
    }
}
