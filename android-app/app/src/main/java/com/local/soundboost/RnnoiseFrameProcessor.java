package com.local.soundboost;

/**
 * Aggregates PCM16 samples into the fixed 480-sample frames required by RNNoise.
 *
 * <p>{@link #process} and {@link #close} must be called from the same audio thread.
 * {@link #setEnabled} may be called from another thread.
 */
public final class RnnoiseFrameProcessor implements AutoCloseable {
    private static final int FRAME_SIZE = RnnoiseBridge.FRAME_SIZE;
    private static final float DEFAULT_NOISE_FLOOR_RMS = 0.01f;

    private final Denoiser denoiser;
    private final SpeechProtection speechProtection = new SpeechProtection();
    private final short[] inputFrame = new short[FRAME_SIZE];
    private final short[] outputFrame = new short[FRAME_SIZE];
    private final short[] protectedFrame = new short[FRAME_SIZE];

    private volatile boolean enabled = true;
    private volatile boolean available;
    private long handle;
    private int pendingCount;
    private boolean lastFrameEnabled = true;

    public RnnoiseFrameProcessor() {
        this(new BridgeDenoiser());
    }

    RnnoiseFrameProcessor(Denoiser denoiser) {
        if (denoiser == null) {
            throw new NullPointerException("denoiser");
        }
        this.denoiser = denoiser;
        try {
            handle = denoiser.create();
        } catch (RuntimeException | LinkageError failure) {
            handle = 0L;
        }
        available = handle != 0L;
    }

    public boolean isAvailable() {
        return available;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    /**
     * Consumes an arbitrary PCM16 chunk and writes only complete 480-sample frames.
     *
     * <p>{@code input} and {@code output} must be different arrays because pending samples can
     * make one call produce more samples than it consumes.
     *
     * @return the number of samples written to {@code output}
     */
    public int process(
            short[] input,
            int offset,
            int length,
            short[] output,
            int outputOffset
    ) {
        validateRanges(input, offset, length, output, outputOffset);
        int produced = completeOutputSize(length);
        if (produced > output.length - outputOffset) {
            throw new IllegalArgumentException(
                    "output capacity must include samples pending from earlier chunks"
            );
        }

        int inputOffset = offset;
        int inputRemaining = length;
        int writeOffset = outputOffset;
        while (inputRemaining > 0) {
            int copyLength = Math.min(FRAME_SIZE - pendingCount, inputRemaining);
            System.arraycopy(input, inputOffset, inputFrame, pendingCount, copyLength);
            inputOffset += copyLength;
            inputRemaining -= copyLength;
            pendingCount += copyLength;

            if (pendingCount == FRAME_SIZE) {
                processCompleteFrame(output, writeOffset);
                pendingCount = 0;
                writeOffset += FRAME_SIZE;
            }
        }
        return produced;
    }

    @Override
    public void close() {
        disableDenoiser();
        speechProtection.reset();
    }

    private int completeOutputSize(int inputLength) {
        long totalSamples = (long) pendingCount + inputLength;
        return (int) (totalSamples / FRAME_SIZE * FRAME_SIZE);
    }

    private void processCompleteFrame(short[] output, int outputOffset) {
        boolean denoiseFrame = enabled && available;
        if (denoiseFrame != lastFrameEnabled) {
            speechProtection.reset();
            lastFrameEnabled = denoiseFrame;
        }
        if (!denoiseFrame) {
            System.arraycopy(inputFrame, 0, output, outputOffset, FRAME_SIZE);
            return;
        }

        float vadProbability;
        try {
            vadProbability = denoiser.process(handle, inputFrame, outputFrame);
        } catch (RuntimeException | LinkageError failure) {
            bypassAfterFailure(output, outputOffset);
            return;
        }
        if (vadProbability < 0f
                || Float.isNaN(vadProbability)
                || Float.isInfinite(vadProbability)) {
            bypassAfterFailure(output, outputOffset);
            return;
        }

        float dryMix = speechProtection.dryMixFor(
                vadProbability,
                normalizedRms(inputFrame),
                DEFAULT_NOISE_FLOOR_RMS
        );
        for (int index = 0; index < FRAME_SIZE; index++) {
            protectedFrame[index] = SpeechProtection.mixPcm16(
                    outputFrame[index],
                    inputFrame[index],
                    dryMix
            );
        }
        System.arraycopy(protectedFrame, 0, output, outputOffset, FRAME_SIZE);
    }

    private void bypassAfterFailure(short[] output, int outputOffset) {
        disableDenoiser();
        speechProtection.reset();
        lastFrameEnabled = false;
        System.arraycopy(inputFrame, 0, output, outputOffset, FRAME_SIZE);
    }

    private void disableDenoiser() {
        available = false;
        long handleToDestroy = handle;
        handle = 0L;
        if (handleToDestroy == 0L) {
            return;
        }
        try {
            denoiser.destroy(handleToDestroy);
        } catch (RuntimeException | LinkageError failure) {
            // Teardown is best-effort; the handle is never reused after this point.
        }
    }

    private static float normalizedRms(short[] frame) {
        double sumOfSquares = 0.0;
        for (short sample : frame) {
            double normalized = sample / 32768.0;
            sumOfSquares += normalized * normalized;
        }
        return (float) Math.sqrt(sumOfSquares / FRAME_SIZE);
    }

    private static void validateRanges(
            short[] input,
            int offset,
            int length,
            short[] output,
            int outputOffset
    ) {
        if (input == null) {
            throw new NullPointerException("input");
        }
        if (output == null) {
            throw new NullPointerException("output");
        }
        if (input == output) {
            throw new IllegalArgumentException("input and output must be different arrays");
        }
        if (offset < 0 || length < 0 || offset > input.length - length) {
            throw new IndexOutOfBoundsException("invalid input offset or length");
        }
        if (outputOffset < 0 || outputOffset > output.length) {
            throw new IndexOutOfBoundsException("invalid output offset");
        }
    }
}

interface Denoiser {
    long create();

    float process(long handle, short[] input, short[] output);

    void destroy(long handle);
}

final class BridgeDenoiser implements Denoiser {
    @Override
    public long create() {
        return RnnoiseBridge.create();
    }

    @Override
    public float process(long handle, short[] input, short[] output) {
        return RnnoiseBridge.process(handle, input, output);
    }

    @Override
    public void destroy(long handle) {
        RnnoiseBridge.destroy(handle);
    }
}
