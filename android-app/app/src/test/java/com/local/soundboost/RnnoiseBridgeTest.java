package com.local.soundboost;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

public class RnnoiseBridgeTest {
    @Test
    public void reportsUnavailableWhenNativeLibraryIsMissing() {
        assertFalse(RnnoiseBridge.isAvailable());
    }

    @Test
    public void createReturnsZeroWhenNativeLibraryIsMissing() {
        assertEquals(0L, RnnoiseBridge.create());
    }

    @Test
    public void rejectsInvalidFrameLengths() {
        short[] frame = new short[RnnoiseBridge.FRAME_SIZE];

        assertEquals(
                -1.0f,
                RnnoiseBridge.process(1L, new short[RnnoiseBridge.FRAME_SIZE - 1], frame),
                0.0f
        );
        assertEquals(
                -1.0f,
                RnnoiseBridge.process(1L, frame, new short[RnnoiseBridge.FRAME_SIZE - 1]),
                0.0f
        );
    }

    @Test
    public void destroyZeroIsIdempotent() {
        RnnoiseBridge.destroy(0L);
        RnnoiseBridge.destroy(0L);
    }
}
