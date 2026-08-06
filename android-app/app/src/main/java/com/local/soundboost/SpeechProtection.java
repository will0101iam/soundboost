package com.local.soundboost;

/**
 * Protects active speech that RNNoise reports with low confidence.
 *
 * <p>This class is stateful and intended to be confined to one 10 ms audio-frame thread.
 */
public final class SpeechProtection {
    private static final float ENTER_VAD_THRESHOLD = 0.20f;
    private static final float EXIT_VAD_THRESHOLD = 0.60f;
    private static final float MINIMUM_DRY_MIX = 0.30f;
    private static final float MINIMUM_ACTIVE_RMS = 0.01f;
    private static final float NOISE_FLOOR_RATIO = 2.0f;
    private static final int HOLD_FRAMES = 15;

    private boolean protecting;
    private int holdFramesRemaining;

    public float dryMixFor(float vadProbability, float rms, float noiseFloorRms) {
        if (!hasActiveEnergy(rms, noiseFloorRms)) {
            countDownHold();
            return 0f;
        }

        float vad = clamp(vadProbability, 0f, 1f);
        if (!protecting) {
            if (vad <= ENTER_VAD_THRESHOLD) {
                protecting = true;
                holdFramesRemaining = HOLD_FRAMES;
                return MINIMUM_DRY_MIX;
            }
            return 0f;
        }

        if (vad < EXIT_VAD_THRESHOLD) {
            holdFramesRemaining = HOLD_FRAMES;
            return MINIMUM_DRY_MIX;
        }

        countDownHold();
        return protecting ? MINIMUM_DRY_MIX : 0f;
    }

    public void reset() {
        protecting = false;
        holdFramesRemaining = 0;
    }

    public static short mixPcm16(short denoised, short dry, float dryMix) {
        float mix = clamp(dryMix, 0f, 1f);
        int mixed = Math.round(denoised + (dry - denoised) * mix);
        if (mixed > Short.MAX_VALUE) {
            return Short.MAX_VALUE;
        }
        if (mixed < Short.MIN_VALUE) {
            return Short.MIN_VALUE;
        }
        return (short) mixed;
    }

    private boolean hasActiveEnergy(float rms, float noiseFloorRms) {
        float signal = finiteNonNegative(rms);
        float noiseFloor = finiteNonNegative(noiseFloorRms);
        float activeThreshold = Math.max(MINIMUM_ACTIVE_RMS, noiseFloor * NOISE_FLOOR_RATIO);
        return signal >= activeThreshold;
    }

    private void countDownHold() {
        if (!protecting) {
            return;
        }
        holdFramesRemaining--;
        if (holdFramesRemaining <= 0) {
            reset();
        }
    }

    private static float finiteNonNegative(float value) {
        return Float.isNaN(value) || value < 0f ? 0f : value;
    }

    private static float clamp(float value, float minimum, float maximum) {
        if (Float.isNaN(value)) {
            return minimum;
        }
        return Math.max(minimum, Math.min(maximum, value));
    }
}
