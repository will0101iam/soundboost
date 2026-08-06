#include <jni.h>

#include <math.h>
#include <stdint.h>

#include "rnnoise.h"

#define RNNOISE_FRAME_SIZE 480
#define PROCESS_ERROR (-1.0f)

static DenoiseState *state_from_handle(jlong handle) {
    return (DenoiseState *)(intptr_t)handle;
}

static int clear_jni_exception(JNIEnv *env) {
    if (!(*env)->ExceptionCheck(env)) {
        return 0;
    }
    (*env)->ExceptionClear(env);
    return 1;
}

static jshort pcm16_from_float(float sample) {
    long rounded;

    if (!isfinite(sample)) {
        return 0;
    }
    if (sample >= 32767.0f) {
        return 32767;
    }
    if (sample <= -32768.0f) {
        return -32768;
    }

    rounded = lrintf(sample);
    if (rounded > 32767L) {
        return 32767;
    }
    if (rounded < -32768L) {
        return -32768;
    }
    return (jshort)rounded;
}

JNIEXPORT jlong JNICALL
Java_com_local_soundboost_RnnoiseBridge_nativeCreate(JNIEnv *env, jclass clazz) {
    DenoiseState *state;

    (void)env;
    (void)clazz;

    if (rnnoise_get_frame_size() != RNNOISE_FRAME_SIZE) {
        return 0;
    }

    state = rnnoise_create(NULL);
    return (jlong)(intptr_t)state;
}

JNIEXPORT jfloat JNICALL
Java_com_local_soundboost_RnnoiseBridge_nativeProcess(
        JNIEnv *env,
        jclass clazz,
        jlong handle,
        jshortArray input,
        jshortArray output) {
    DenoiseState *state = state_from_handle(handle);
    jshort input_pcm[RNNOISE_FRAME_SIZE];
    jshort output_pcm[RNNOISE_FRAME_SIZE];
    float input_float[RNNOISE_FRAME_SIZE];
    float output_float[RNNOISE_FRAME_SIZE];
    float vad_probability;
    jsize input_length;
    jsize output_length;
    int sample;

    (void)clazz;

    if (env == NULL || state == NULL || input == NULL || output == NULL) {
        return PROCESS_ERROR;
    }
    input_length = (*env)->GetArrayLength(env, input);
    if (clear_jni_exception(env)) {
        return PROCESS_ERROR;
    }
    output_length = (*env)->GetArrayLength(env, output);
    if (clear_jni_exception(env)) {
        return PROCESS_ERROR;
    }
    if (input_length != RNNOISE_FRAME_SIZE || output_length != RNNOISE_FRAME_SIZE) {
        return PROCESS_ERROR;
    }

    (*env)->GetShortArrayRegion(env, input, 0, RNNOISE_FRAME_SIZE, input_pcm);
    if (clear_jni_exception(env)) {
        return PROCESS_ERROR;
    }

    for (sample = 0; sample < RNNOISE_FRAME_SIZE; sample++) {
        input_float[sample] = (float)input_pcm[sample];
    }

    vad_probability = rnnoise_process_frame(state, output_float, input_float);
    if (!isfinite(vad_probability)) {
        return PROCESS_ERROR;
    }

    for (sample = 0; sample < RNNOISE_FRAME_SIZE; sample++) {
        output_pcm[sample] = pcm16_from_float(output_float[sample]);
    }

    (*env)->SetShortArrayRegion(env, output, 0, RNNOISE_FRAME_SIZE, output_pcm);
    if (clear_jni_exception(env)) {
        return PROCESS_ERROR;
    }
    return vad_probability;
}

JNIEXPORT void JNICALL
Java_com_local_soundboost_RnnoiseBridge_nativeDestroy(
        JNIEnv *env,
        jclass clazz,
        jlong handle) {
    DenoiseState *state = state_from_handle(handle);

    (void)env;
    (void)clazz;

    if (state != NULL) {
        rnnoise_destroy(state);
    }
}
