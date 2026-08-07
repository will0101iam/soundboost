package com.local.soundboost;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioDeviceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
    private static final int REQ_RECORD_AUDIO = 1001;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private AudioEngine engine;
    private TextView status;
    private ProgressBar inputMeter;
    private ProgressBar outputMeter;
    private SeekBar volumeSeek;
    private SeekBar claritySeek;
    private SeekBar compressionSeek;
    private SeekBar lowCutSeek;
    private SeekBar limitSeek;
    private Switch rnnoiseSwitch;

    private int volumeDb = 3;
    private int clarity = 55;
    private int compression = 35;
    private int lowCutHz = 90;
    private int limitDb = -8;
    private boolean rnnoiseEnabled = true;

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        setContentView(buildUi());
    }

    @Override
    protected void onStop() {
        super.onStop();
        stopListening();
    }

    private View buildUi() {
        int pad = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        root.setBackgroundColor(Color.rgb(245, 242, 235));

        TextView title = new TextView(this);
        title.setText("声音增强测试");
        title.setTextSize(30);
        title.setTextColor(Color.rgb(24, 32, 29));
        title.setGravity(Gravity.START);
        title.setTypeface(null, 1);
        root.addView(title, matchWrap());

        status = new TextView(this);
        status.setText("未开始");
        status.setTextSize(16);
        status.setTextColor(Color.rgb(80, 96, 88));
        status.setPadding(0, dp(12), 0, dp(18));
        root.addView(status, matchWrap());

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(0, 0, 0, dp(14));
        Button start = button("开始");
        Button stop = button("停止");
        actions.addView(start, weightWrap(1));
        actions.addView(stop, weightWrap(1));
        root.addView(actions, matchWrap());

        start.setOnClickListener(v -> startListening());
        stop.setOnClickListener(v -> stopListening());

        inputMeter = meter(root, "输入");
        outputMeter = meter(root, "输出");

        rnnoiseSwitch = new Switch(this);
        rnnoiseSwitch.setText("RNNoise 降噪");
        rnnoiseSwitch.setTextSize(16);
        rnnoiseSwitch.setTextColor(Color.rgb(24, 32, 29));
        rnnoiseSwitch.setChecked(rnnoiseEnabled);
        rnnoiseSwitch.setPadding(0, dp(14), 0, dp(4));
        rnnoiseSwitch.setOnCheckedChangeListener((button, checked) -> {
            rnnoiseEnabled = checked;
            if (engine != null) {
                engine.setDenoiseEnabled(checked);
            }
        });
        root.addView(rnnoiseSwitch, matchWrap());

        volumeSeek = slider(root, "音量", -12, 12, volumeDb, "dB", value -> {
            volumeDb = value;
            applySettings();
        });
        claritySeek = slider(root, "清晰度", 0, 100, clarity, "%", value -> {
            clarity = value;
            applySettings();
        });
        compressionSeek = slider(root, "压缩", 0, 100, compression, "%", value -> {
            compression = value;
            applySettings();
        });
        lowCutSeek = slider(root, "低频过滤", 40, 240, lowCutHz, "Hz", value -> {
            lowCutHz = value;
            applySettings();
        });
        limitSeek = slider(root, "数字峰值上限", -24, -1, limitDb, "dBFS", value -> {
            limitDb = value;
            applySettings();
        });

        LinearLayout presets = new LinearLayout(this);
        presets.setOrientation(LinearLayout.VERTICAL);
        presets.setPadding(0, dp(10), 0, 0);
        presets.addView(preset("自然", 3, 55, 25, -10), matchWrap());
        presets.addView(preset("明显变响", 8, 60, 45, -8), matchWrap());
        presets.addView(preset("人声突出", 10, 70, 55, -6), matchWrap());
        presets.addView(preset("低峰值", 5, 60, 40, -14), matchWrap());
        root.addView(presets, matchWrap());

        TextView note = new TextView(this);
        note.setText(
                "使用手机麦克风输入、蓝牙耳机媒体输出。"
                        + "数字峰值受限不代表耳机声压安全，请从低音量开始。"
        );
        note.setTextSize(14);
        note.setTextColor(Color.rgb(92, 107, 101));
        note.setPadding(0, dp(16), 0, 0);
        root.addView(note, matchWrap());

        return root;
    }

    private void startListening() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
            return;
        }
        if (running.get()) return;
        engine = new AudioEngine();
        engine.setSettings(volumeDb, clarity, compression, lowCutHz, limitDb);
        engine.setDenoiseEnabled(rnnoiseEnabled);
        running.set(true);
        status.setText("正在启动音频");
        engine.start();
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_RECORD_AUDIO) {
            return;
        }
        if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startListening();
        } else {
            status.setText("麦克风权限被拒绝");
        }
    }

    private void stopListening() {
        running.set(false);
        if (engine != null) {
            engine.stop();
            engine = null;
        }
        status.setText("未开始");
        inputMeter.setProgress(0);
        outputMeter.setProgress(0);
    }

    private void applySettings() {
        if (engine != null) {
            engine.setSettings(volumeDb, clarity, compression, lowCutHz, limitDb);
        }
    }

    private ProgressBar meter(LinearLayout root, String label) {
        TextView text = new TextView(this);
        text.setText(label);
        text.setTextColor(Color.rgb(64, 80, 73));
        text.setTextSize(15);
        text.setTypeface(null, 1);
        text.setPadding(0, dp(10), 0, dp(5));
        root.addView(text, matchWrap());

        ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, matchWrap());
        return bar;
    }

    private SeekBar slider(LinearLayout root, String label, int min, int max, int initial, String suffix, IntSetter setter) {
        TextView valueLabel = new TextView(this);
        valueLabel.setText(String.format(Locale.CHINA, "%s: %d %s", label, initial, suffix));
        valueLabel.setTextSize(16);
        valueLabel.setTextColor(Color.rgb(24, 32, 29));
        valueLabel.setTypeface(null, 1);
        valueLabel.setPadding(0, dp(14), 0, 0);
        root.addView(valueLabel, matchWrap());

        SeekBar seek = new SeekBar(this);
        seek.setMax(max - min);
        seek.setProgress(initial - min);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                int value = min + progress;
                valueLabel.setText(String.format(Locale.CHINA, "%s: %d %s", label, value, suffix));
                setter.set(value);
            }

            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });
        root.addView(seek, matchWrap());
        return seek;
    }

    private Button preset(String label, int vol, int clear, int comp, int lim) {
        Button button = button(label);
        button.setOnClickListener(v -> {
            if (volumeSeek != null) volumeSeek.setProgress(vol + 12);
            if (claritySeek != null) claritySeek.setProgress(clear);
            if (compressionSeek != null) compressionSeek.setProgress(comp);
            if (lowCutSeek != null) lowCutSeek.setProgress(lowCutHz - 40);
            if (limitSeek != null) limitSeek.setProgress(lim + 24);
        });
        return button;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(16);
        button.setAllCaps(false);
        return button;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private LinearLayout.LayoutParams weightWrap(int weight) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(52), weight);
        params.setMargins(dp(4), 0, dp(4), 0);
        return params;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private interface IntSetter {
        void set(int value);
    }

    private class AudioEngine {
        private static final int RNNOISE_SAMPLE_RATE = 48000;
        private static final int FALLBACK_SAMPLE_RATE = 44100;
        private final AtomicBoolean active = new AtomicBoolean(false);
        private Thread thread;
        private volatile AudioRecord activeRecorder;
        private volatile AudioTrack activePlayer;

        private volatile int configuredVolumeDb = 3;
        private volatile int configuredClarity = 55;
        private volatile int configuredCompression = 35;
        private volatile int configuredLowCutHz = 90;
        private volatile int configuredLimitDb = -8;
        private volatile boolean denoiseEnabled = true;

        void setSettings(int volumeDb, int clarity, int compression, int lowCutHz, int limitDb) {
            configuredVolumeDb = volumeDb;
            configuredClarity = clarity;
            configuredCompression = compression;
            configuredLowCutHz = lowCutHz;
            configuredLimitDb = limitDb;
        }

        void setDenoiseEnabled(boolean enabled) {
            denoiseEnabled = enabled;
        }

        void start() {
            active.set(true);
            thread = new Thread(this::loop, "soundboost-audio");
            thread.start();
        }

        void stop() {
            active.set(false);
            AudioRecord recorder = activeRecorder;
            if (recorder != null) {
                try {
                    recorder.stop();
                } catch (Exception ignored) {
                    // The audio thread may already be releasing the recorder.
                }
            }
            AudioTrack player = activePlayer;
            if (player != null) {
                try {
                    player.pause();
                } catch (Exception ignored) {
                    // The audio thread may already be releasing the player.
                }
            }
            if (thread != null) {
                try {
                    thread.join(700);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        private void loop() {
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
            int sampleRate = selectSampleRate();
            int minIn = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            int minOut = AudioTrack.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            if (minIn <= 0 || minOut <= 0) {
                reportFailure("当前设备不支持实时音频采样");
                return;
            }
            int bufferBytes = Math.max(minIn, minOut) * 2;
            int frames = Math.max(960, bufferBytes / 2);
            short[] input = new short[frames];
            short[] denoised = new short[frames + RnnoiseBridge.FRAME_SIZE - 1];
            short[] output = new short[denoised.length];

            AudioRecord recorder = null;
            AudioTrack player = null;
            RnnoiseFrameProcessor frameProcessor = null;
            AudioDsp dsp = new AudioDsp(sampleRate);

            try {
                recorder = createRecorder(sampleRate, bufferBytes);
                preferBuiltInMicrophone(recorder);
                player = createPlayer(sampleRate, bufferBytes);
                activeRecorder = recorder;
                activePlayer = player;
                if (sampleRate == RNNOISE_SAMPLE_RATE) {
                    frameProcessor = new RnnoiseFrameProcessor();
                    frameProcessor.setEnabled(denoiseEnabled);
                }

                recorder.startRecording();
                player.play();
                reportRunningStatus(recorder, player, frameProcessor, sampleRate);

                while (active.get()) {
                    int read = recorder.read(input, 0, input.length);
                    if (read < 0) {
                        throw new IllegalStateException("麦克风读取失败: " + read);
                    }
                    if (read == 0) {
                        continue;
                    }

                    float inPeak = 0;
                    for (int index = 0; index < read; index++) {
                        inPeak = Math.max(inPeak, Math.abs(input[index] / 32768.0f));
                    }

                    int processed;
                    if (frameProcessor == null) {
                        System.arraycopy(input, 0, denoised, 0, read);
                        processed = read;
                    } else {
                        frameProcessor.setEnabled(denoiseEnabled);
                        boolean wasAvailable = frameProcessor.isAvailable();
                        processed = frameProcessor.process(input, 0, read, denoised, 0);
                        if (wasAvailable && !frameProcessor.isAvailable()) {
                            runOnUiThread(() ->
                                    status.setText("正在监听 · RNNoise 异常，已旁路")
                            );
                        }
                    }
                    if (processed == 0) {
                        continue;
                    }

                    dsp.setSettings(
                            configuredVolumeDb,
                            configuredClarity,
                            configuredCompression,
                            configuredLowCutHz,
                            configuredLimitDb
                    );
                    float outPeak = 0;
                    for (int index = 0; index < processed; index++) {
                        output[index] = dsp.process(denoised[index]);
                        outPeak = Math.max(
                                outPeak,
                                Math.abs(output[index] / 32768.0f)
                        );
                    }
                    writeFully(player, output, processed);

                    float finalIn = inPeak;
                    float finalOut = outPeak;
                    runOnUiThread(() -> {
                        inputMeter.setProgress((int) Math.min(100, finalIn * 220));
                        outputMeter.setProgress((int) Math.min(100, finalOut * 220));
                    });
                }
            } catch (Exception ex) {
                if (active.get()) {
                    reportFailure(ex.getMessage());
                }
            } finally {
                activeRecorder = null;
                activePlayer = null;
                if (frameProcessor != null) {
                    frameProcessor.close();
                }
                if (recorder != null) {
                    try { recorder.stop(); } catch (Exception ignored) {}
                    recorder.release();
                }
                if (player != null) {
                    try { player.stop(); } catch (Exception ignored) {}
                    player.release();
                }
            }
        }

        private int selectSampleRate() {
            if (supportsSampleRate(RNNOISE_SAMPLE_RATE)) {
                return RNNOISE_SAMPLE_RATE;
            }
            if (supportsSampleRate(FALLBACK_SAMPLE_RATE)) {
                return FALLBACK_SAMPLE_RATE;
            }
            return RNNOISE_SAMPLE_RATE;
        }

        private boolean supportsSampleRate(int sampleRate) {
            return AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            ) > 0 && AudioTrack.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            ) > 0;
        }

        private AudioRecord createRecorder(int sampleRate, int bufferBytes) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return new AudioRecord.Builder()
                        .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(sampleRate)
                                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build())
                        .setBufferSizeInBytes(bufferBytes)
                        .build();
            }
            return new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferBytes
            );
        }

        private AudioTrack createPlayer(int sampleRate, int bufferBytes) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(sampleRate)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build())
                        .setBufferSizeInBytes(bufferBytes)
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build();
            }
            return new AudioTrack(
                    android.media.AudioManager.STREAM_MUSIC,
                    sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferBytes,
                    AudioTrack.MODE_STREAM
            );
        }

        private void preferBuiltInMicrophone(AudioRecord recorder) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                return;
            }
            AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (manager == null) {
                return;
            }
            for (AudioDeviceInfo device :
                    manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                    recorder.setPreferredDevice(device);
                    return;
                }
            }
        }

        private void writeFully(AudioTrack player, short[] output, int length) {
            int offset = 0;
            while (offset < length && active.get()) {
                int written = player.write(output, offset, length - offset);
                if (written < 0) {
                    throw new IllegalStateException("耳机输出失败: " + written);
                }
                if (written == 0) {
                    Thread.yield();
                    continue;
                }
                offset += written;
            }
        }

        private void reportRunningStatus(
                AudioRecord recorder,
                AudioTrack player,
                RnnoiseFrameProcessor frameProcessor,
                int sampleRate
        ) {
            String rnnoiseState;
            if (frameProcessor == null) {
                rnnoiseState = "RNNoise 旁路（" + sampleRate + " Hz）";
            } else if (denoiseEnabled && frameProcessor.isAvailable()) {
                rnnoiseState = "RNNoise 开启";
            } else {
                rnnoiseState = "RNNoise 旁路";
            }
            String route = routeLabel(recorder, player);
            runOnUiThread(() ->
                    status.setText("正在监听 · " + rnnoiseState + " · " + route)
            );
        }

        private String routeLabel(AudioRecord recorder, AudioTrack player) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                return "系统音频路由";
            }
            AudioDeviceInfo input = recorder.getRoutedDevice();
            AudioDeviceInfo output = player.getRoutedDevice();
            return "输入 " + deviceLabel(input) + " / 输出 " + deviceLabel(output);
        }

        private String deviceLabel(AudioDeviceInfo device) {
            if (device == null) {
                return "系统默认";
            }
            switch (device.getType()) {
                case AudioDeviceInfo.TYPE_BUILTIN_MIC:
                    return "手机麦克风";
                case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                    return "蓝牙媒体耳机";
                case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                    return "蓝牙通话设备";
                case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                    return "有线耳机";
                case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                    return "手机扬声器";
                default:
                    CharSequence name = device.getProductName();
                    return name == null || name.length() == 0
                            ? "系统设备"
                            : name.toString();
            }
        }

        private void reportFailure(String message) {
            active.set(false);
            running.set(false);
            String detail = message == null || message.length() == 0
                    ? "未知错误"
                    : message;
            runOnUiThread(() -> status.setText("音频启动失败: " + detail));
        }
    }
}
