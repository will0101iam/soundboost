package com.local.soundboost;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SpeechProtectionTest {
    private static final float EPSILON = 0.001f;

    @Test
    public void preservesDrySpeechWhenVadIsLowButEnergyIsActive() {
        SpeechProtection protection = new SpeechProtection();

        float dryMix = protection.dryMixFor(0.05f, 0.08f, 0.01f);

        assertTrue(dryMix >= 0.30f);
    }

    @Test
    public void usesDenoisedSignalWhenVadIsHigh() {
        SpeechProtection protection = new SpeechProtection();

        assertEquals(0f, protection.dryMixFor(0.80f, 0.08f, 0.01f), EPSILON);
    }

    @Test
    public void doesNotMixDrySignalForSilence() {
        SpeechProtection protection = new SpeechProtection();
        protection.dryMixFor(0.05f, 0.08f, 0.01f);

        assertEquals(0f, protection.dryMixFor(0.05f, 0.002f, 0.002f), EPSILON);
    }

    @Test
    public void doesNotProtectEnergyNearNoiseFloor() {
        SpeechProtection protection = new SpeechProtection();

        assertEquals(0f, protection.dryMixFor(0.05f, 0.015f, 0.01f), EPSILON);
    }

    @Test
    public void usesHysteresisToIgnoreVadJitter() {
        SpeechProtection protection = new SpeechProtection();
        protection.dryMixFor(0.19f, 0.08f, 0.01f);

        assertTrue(protection.dryMixFor(0.21f, 0.08f, 0.01f) >= 0.30f);
    }

    @Test
    public void holdsProtectionForFifteenTenMillisecondFrames() {
        SpeechProtection protection = new SpeechProtection();
        assertTrue(protection.dryMixFor(0.05f, 0.08f, 0.01f) >= 0.30f);

        for (int frame = 1; frame < 15; frame++) {
            assertTrue(protection.dryMixFor(0.80f, 0.08f, 0.01f) >= 0.30f);
        }
        assertEquals(0f, protection.dryMixFor(0.80f, 0.08f, 0.01f), EPSILON);
    }

    @Test
    public void resetClearsProtectionState() {
        SpeechProtection protection = new SpeechProtection();
        protection.dryMixFor(0.05f, 0.08f, 0.01f);

        protection.reset();

        assertEquals(0f, protection.dryMixFor(0.40f, 0.08f, 0.01f), EPSILON);
    }

    @Test
    public void pcmMixSaturatesAtPositiveLimitWithoutOverflow() {
        assertEquals(
                Short.MAX_VALUE,
                SpeechProtection.mixPcm16(Short.MAX_VALUE, Short.MAX_VALUE, 0.30f)
        );
    }

    @Test
    public void pcmMixSaturatesAtNegativeLimitWithoutOverflow() {
        assertEquals(
                Short.MIN_VALUE,
                SpeechProtection.mixPcm16(Short.MIN_VALUE, Short.MIN_VALUE, 0.30f)
        );
    }
}
