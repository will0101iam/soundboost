package com.local.soundboost;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class RnnoiseFrameProcessorTest {
    private static final int FRAME_SIZE = 480;

    @Test
    public void aggregatesArbitraryChunksIntoCompleteFrames() {
        FakeDenoiser denoiser = new FakeDenoiser();
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = sequence(1_440);
        short[] firstOutput = new short[480];
        short[] secondOutput = new short[960];

        assertEquals(0, processor.process(source, 0, 137, firstOutput, 0));
        assertEquals(480, processor.process(source, 137, 500, firstOutput, 0));
        assertEquals(960, processor.process(source, 637, 803, secondOutput, 0));

        assertArrayEquals(Arrays.copyOfRange(source, 0, 480), firstOutput);
        assertArrayEquals(Arrays.copyOfRange(source, 480, 1_440), secondOutput);
        assertEquals(3, denoiser.processCalls);
    }

    @Test
    public void preservesEverySampleExactlyOnceAcrossChunkBoundaries() {
        FakeDenoiser denoiser = new FakeDenoiser();
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = sequence(960);
        short[] emitted = new short[960];
        int emittedCount = 0;
        int consumed = 0;
        int[] chunkLengths = {1, 478, 2, 300, 179};

        for (int chunkLength : chunkLengths) {
            emittedCount += processor.process(
                    source,
                    consumed,
                    chunkLength,
                    emitted,
                    emittedCount
            );
            consumed += chunkLength;
        }

        assertEquals(source.length, consumed);
        assertEquals(source.length, emittedCount);
        assertArrayEquals(source, emitted);
    }

    @Test
    public void requiresCapacityForPendingSamplesBeforeConsumingChunk() {
        FakeDenoiser denoiser = new FakeDenoiser();
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = sequence(480);

        assertEquals(0, processor.process(source, 0, 479, new short[0], 0));
        expectIllegalArgument(() ->
                processor.process(source, 479, 1, new short[479], 0)
        );

        short[] output = new short[480];
        assertEquals(480, processor.process(source, 479, 1, output, 0));
        assertArrayEquals(source, output);
    }

    @Test
    public void bypassesStablyWhileRnnoiseIsDisabled() {
        FakeDenoiser denoiser = new FakeDenoiser();
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = sequence(960);
        short[] output = new short[960];

        processor.setEnabled(false);

        assertEquals(960, processor.process(source, 0, source.length, output, 0));
        assertArrayEquals(source, output);
        assertEquals(0, denoiser.processCalls);
        assertTrue(processor.isAvailable());
    }

    @Test
    public void negativeNativeResultBypassesCurrentAndFutureFrames() {
        FakeDenoiser denoiser = new FakeDenoiser();
        denoiser.result = -1.0f;
        denoiser.outputSample = 0;
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = filled(960, (short) 8_000);
        short[] output = new short[960];

        assertEquals(960, processor.process(source, 0, source.length, output, 0));

        assertArrayEquals(source, output);
        assertEquals(1, denoiser.processCalls);
        assertEquals(1, denoiser.destroyCalls);
        assertFalse(processor.isAvailable());
    }

    @Test
    public void nativeExceptionBypassesCurrentAndFutureFrames() {
        FakeDenoiser denoiser = new FakeDenoiser();
        denoiser.processFailure = new IllegalStateException("native failure");
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = filled(960, (short) 7_000);
        short[] output = new short[960];

        assertEquals(960, processor.process(source, 0, source.length, output, 0));

        assertArrayEquals(source, output);
        assertEquals(1, denoiser.processCalls);
        assertEquals(1, denoiser.destroyCalls);
        assertFalse(processor.isAvailable());
    }

    @Test
    public void mixesBackAtLeastThirtyPercentForSuppressedLowVadSpeech() {
        FakeDenoiser denoiser = new FakeDenoiser();
        denoiser.result = 0.05f;
        denoiser.outputSample = 0;
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = filled(FRAME_SIZE, (short) 10_000);
        short[] output = new short[FRAME_SIZE];

        assertEquals(
                FRAME_SIZE,
                processor.process(source, 0, source.length, output, 0)
        );

        for (short sample : output) {
            assertTrue("protected sample was " + sample, sample >= 3_000);
        }
    }

    @Test
    public void togglingEnabledKeepsPendingAudioAndNeverEmitsSilence() {
        FakeDenoiser denoiser = new FakeDenoiser();
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] firstHalf = filled(240, (short) 1_111);
        short[] secondHalf = filled(240, (short) 2_222);
        short[] enabledFrame = filled(480, (short) 3_333);
        short[] bypassedOutput = new short[480];
        short[] enabledOutput = new short[480];

        assertEquals(0, processor.process(firstHalf, 0, 240, bypassedOutput, 0));
        processor.setEnabled(false);
        assertEquals(
                480,
                processor.process(secondHalf, 0, 240, bypassedOutput, 0)
        );
        processor.setEnabled(true);
        assertEquals(
                480,
                processor.process(enabledFrame, 0, 480, enabledOutput, 0)
        );

        assertArrayEquals(firstHalf, Arrays.copyOfRange(bypassedOutput, 0, 240));
        assertArrayEquals(secondHalf, Arrays.copyOfRange(bypassedOutput, 240, 480));
        for (short sample : enabledOutput) {
            assertTrue(sample != 0);
        }
    }

    @Test
    public void handleZeroStartsPermanentlyInBypassMode() {
        FakeDenoiser denoiser = new FakeDenoiser();
        denoiser.createdHandle = 0L;
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = sequence(480);
        short[] output = new short[480];

        assertFalse(processor.isAvailable());
        assertEquals(480, processor.process(source, 0, source.length, output, 0));
        assertArrayEquals(source, output);
        assertEquals(0, denoiser.processCalls);
        assertEquals(0, denoiser.destroyCalls);
    }

    @Test
    public void closeDestroysNativeHandleOnlyOnce() {
        FakeDenoiser denoiser = new FakeDenoiser();
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);

        processor.close();
        processor.close();

        assertEquals(1, denoiser.destroyCalls);
        assertEquals(denoiser.createdHandle, denoiser.destroyedHandle);
        assertFalse(processor.isAvailable());
    }

    @Test
    public void reusesNativeInputAndOutputFrameArrays() {
        FakeDenoiser denoiser = new FakeDenoiser();
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(denoiser);
        short[] source = sequence(960);

        processor.process(source, 0, source.length, new short[960], 0);

        assertEquals(2, denoiser.inputFrames.size());
        assertEquals(2, denoiser.outputFrames.size());
        assertSame(denoiser.inputFrames.get(0), denoiser.inputFrames.get(1));
        assertSame(denoiser.outputFrames.get(0), denoiser.outputFrames.get(1));
    }

    @Test
    public void validatesInputRangesAndOutputCapacity() {
        RnnoiseFrameProcessor processor = new RnnoiseFrameProcessor(new FakeDenoiser());
        short[] input = new short[480];
        short[] output = new short[480];

        expectNullPointer(() -> processor.process(null, 0, 0, output, 0));
        expectNullPointer(() -> processor.process(input, 0, 0, null, 0));
        expectIndexOutOfBounds(() -> processor.process(input, -1, 1, output, 0));
        expectIndexOutOfBounds(() -> processor.process(input, 0, -1, output, 0));
        expectIndexOutOfBounds(() -> processor.process(input, 1, 480, output, 0));
        expectIndexOutOfBounds(() -> processor.process(input, 0, 0, output, -1));
        expectIndexOutOfBounds(() -> processor.process(input, 0, 0, output, 481));
        expectIllegalArgument(() ->
                processor.process(input, 0, 480, new short[479], 0)
        );
        expectIllegalArgument(() ->
                processor.process(input, 0, 480, input, 0)
        );
    }

    private static short[] sequence(int length) {
        short[] samples = new short[length];
        for (int index = 0; index < length; index++) {
            samples[index] = (short) (index + 1);
        }
        return samples;
    }

    private static short[] filled(int length, short sample) {
        short[] samples = new short[length];
        Arrays.fill(samples, sample);
        return samples;
    }

    private static void expectNullPointer(ThrowingRunnable runnable) {
        expectFailure(NullPointerException.class, runnable);
    }

    private static void expectIndexOutOfBounds(ThrowingRunnable runnable) {
        expectFailure(IndexOutOfBoundsException.class, runnable);
    }

    private static void expectIllegalArgument(ThrowingRunnable runnable) {
        expectFailure(IllegalArgumentException.class, runnable);
    }

    private static void expectFailure(
            Class<? extends Throwable> expected,
            ThrowingRunnable runnable
    ) {
        try {
            runnable.run();
            fail("Expected " + expected.getSimpleName());
        } catch (Throwable failure) {
            if (!expected.isInstance(failure)) {
                throw failure;
            }
        }
    }

    private interface ThrowingRunnable {
        void run();
    }

    private static final class FakeDenoiser implements Denoiser {
        private long createdHandle = 73L;
        private long destroyedHandle;
        private float result = 0.90f;
        private short outputSample = Short.MIN_VALUE;
        private RuntimeException processFailure;
        private int processCalls;
        private int destroyCalls;
        private final List<short[]> inputFrames = new ArrayList<>();
        private final List<short[]> outputFrames = new ArrayList<>();

        @Override
        public long create() {
            return createdHandle;
        }

        @Override
        public float process(long handle, short[] input, short[] output) {
            processCalls++;
            inputFrames.add(input);
            outputFrames.add(output);
            if (processFailure != null) {
                throw processFailure;
            }
            if (outputSample == Short.MIN_VALUE) {
                System.arraycopy(input, 0, output, 0, input.length);
            } else {
                Arrays.fill(output, outputSample);
            }
            return result;
        }

        @Override
        public void destroy(long handle) {
            destroyCalls++;
            destroyedHandle = handle;
        }
    }
}
