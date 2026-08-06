package com.local.soundboost;

final class RnnoiseBridge {
    static final int FRAME_SIZE = 480;
    private static final float PROCESS_ERROR = -1.0f;
    private static final boolean AVAILABLE = loadNativeLibrary();

    private RnnoiseBridge() {}

    static boolean isAvailable() {
        return AVAILABLE;
    }

    static long create() {
        if (!AVAILABLE) {
            return 0L;
        }
        try {
            return nativeCreate();
        } catch (UnsatisfiedLinkError | SecurityException error) {
            return 0L;
        }
    }

    static float process(long handle, short[] input, short[] output) {
        if (handle == 0L
                || input == null
                || output == null
                || input.length != FRAME_SIZE
                || output.length != FRAME_SIZE
                || !AVAILABLE) {
            return PROCESS_ERROR;
        }
        try {
            return nativeProcess(handle, input, output);
        } catch (UnsatisfiedLinkError | SecurityException error) {
            return PROCESS_ERROR;
        }
    }

    static void destroy(long handle) {
        if (handle == 0L || !AVAILABLE) {
            return;
        }
        try {
            nativeDestroy(handle);
        } catch (UnsatisfiedLinkError | SecurityException error) {
            // Native teardown is best-effort so audio shutdown cannot crash.
        }
    }

    private static boolean loadNativeLibrary() {
        try {
            System.loadLibrary("soundboost_rnnoise");
            return true;
        } catch (UnsatisfiedLinkError | SecurityException error) {
            return false;
        }
    }

    private static native long nativeCreate();

    private static native float nativeProcess(long handle, short[] input, short[] output);

    private static native void nativeDestroy(long handle);
}
