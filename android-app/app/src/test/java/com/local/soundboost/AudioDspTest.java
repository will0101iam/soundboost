package com.local.soundboost;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AudioDspTest {
    @Test
    public void compressionLeavesQuietSamplesLinear() {
        assertEquals(0.05f, AudioDsp.compress(0.05f, 1.0f), 0.0001f);
        assertEquals(-0.05f, AudioDsp.compress(-0.05f, 1.0f), 0.0001f);
    }

    @Test
    public void compressionReducesOnlySamplesAboveThreshold() {
        float compressed = AudioDsp.compress(0.90f, 1.0f);

        assertTrue(compressed > 0.0f);
        assertTrue(compressed < 0.90f);
    }

    @Test
    public void volumeGainIsClampedToTwelveDecibels() {
        assertEquals(
                AudioDsp.dbToGain(12.0f),
                AudioDsp.volumeGainFor(24),
                0.0001f
        );
    }

    @Test
    public void digitalCeilingNeverExceedsConfiguredLimit() {
        float ceiling = AudioDsp.dbToGain(-8.0f);

        assertEquals(ceiling, AudioDsp.limit(1.0f, ceiling), 0.0001f);
        assertEquals(-ceiling, AudioDsp.limit(-1.0f, ceiling), 0.0001f);
    }

    @Test
    public void continuousSpeechProcessingStaysFiniteAndInsideCeiling() {
        AudioDsp dsp = new AudioDsp(48_000);
        dsp.setSettings(12, 60, 40, 90, -8);
        int ceilingPcm = Math.round(AudioDsp.dbToGain(-8.0f) * 32767.0f);

        for (int index = 0; index < 48_000; index++) {
            double phase = 2.0 * Math.PI * 220.0 * index / 48_000.0;
            short input = (short) Math.round(Math.sin(phase) * 20_000.0);
            short output = dsp.process(input);

            assertTrue(Math.abs((int) output) <= ceilingPcm + 1);
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsInvalidSampleRate() {
        new AudioDsp(0);
    }
}
