package com.local.soundboost;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFormat;
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

    private int volumeDb = 6;
    private int clarity = 45;
    private int compression = 55;
    private int lowCutHz = 90;
    private int limitDb = -8;

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

        volumeSeek = slider(root, "音量", -12, 24, volumeDb, "dB", value -> {
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
        limitSeek = slider(root, "保护上限", -24, -1, limitDb, "dB", value -> {
            limitDb = value;
            applySettings();
        });

        LinearLayout presets = new LinearLayout(this);
        presets.setOrientation(LinearLayout.VERTICAL);
        presets.setPadding(0, dp(10), 0, 0);
        presets.addView(preset("自然", 0, 30, 20, -10), matchWrap());
        presets.addView(preset("明显变响", 9, 55, 55, -8), matchWrap());
        presets.addView(preset("人声突出", 13, 75, 75, -6), matchWrap());
        presets.addView(preset("舒适保护", 5, 65, 85, -14), matchWrap());
        root.addView(presets, matchWrap());

        TextView note = new TextView(this);
        note.setText("建议戴耳机测试。第一次请从低音量开始，避免啸叫和刺耳。");
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
        running.set(true);
        status.setText("正在监听");
        engine.start();
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
        private static final int SAMPLE_RATE = 48000;
        private final AtomicBoolean active = new AtomicBoolean(false);
        private Thread thread;

        private volatile float volumeGain = dbToGain(6);
        private volatile float clarityAmount = 0.45f;
        private volatile float compressionAmount = 0.55f;
        private volatile float lowCut = 90;
        private volatile float limit = dbToGain(-8);

        void setSettings(int volumeDb, int clarity, int compression, int lowCutHz, int limitDb) {
            this.volumeGain = dbToGain(volumeDb);
            this.clarityAmount = clarity / 100f;
            this.compressionAmount = compression / 100f;
            this.lowCut = lowCutHz;
            this.limit = dbToGain(limitDb);
        }

        void start() {
            active.set(true);
            thread = new Thread(this::loop, "soundboost-audio");
            thread.start();
        }

        void stop() {
            active.set(false);
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
            int minIn = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            int minOut = AudioTrack.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            int frames = Math.max(1024, Math.max(minIn, minOut) / 2);
            short[] input = new short[frames];
            short[] output = new short[frames];

            AudioRecord recorder = createRecorder(frames * 4);
            AudioTrack player = createPlayer(frames * 4);

            Biquad highpass = Biquad.highpass(SAMPLE_RATE, lowCut, 0.7f);
            Biquad presence = Biquad.peaking(SAMPLE_RATE, 2200, 1.0f, 4);
            Biquad brightness = Biquad.highShelf(SAMPLE_RATE, 4200, 2);

            try {
                recorder.startRecording();
                player.play();
                while (active.get()) {
                    highpass.updateHighpass(lowCut);
                    presence.updatePeaking(2200, 1.0f, (clarityAmount - 0.5f) * 20f);
                    brightness.updateHighShelf(4200, Math.max(0, (clarityAmount - 0.35f) * 7f));

                    int read = recorder.read(input, 0, input.length);
                    float inPeak = 0;
                    float outPeak = 0;
                    for (int i = 0; i < read; i++) {
                        float sample = input[i] / 32768f;
                        inPeak = Math.max(inPeak, Math.abs(sample));
                        sample = highpass.process(sample);
                        sample = presence.process(sample);
                        sample = brightness.process(sample);
                        sample = compress(sample, compressionAmount);
                        sample *= volumeGain;
                        sample = limit(sample, limit);
                        outPeak = Math.max(outPeak, Math.abs(sample));
                        output[i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, sample * 32767f));
                    }
                    player.write(output, 0, read);
                    float finalIn = inPeak;
                    float finalOut = outPeak;
                    runOnUiThread(() -> {
                        inputMeter.setProgress((int) Math.min(100, finalIn * 220));
                        outputMeter.setProgress((int) Math.min(100, finalOut * 220));
                    });
                }
            } catch (Exception ex) {
                runOnUiThread(() -> status.setText("音频启动失败: " + ex.getMessage()));
            } finally {
                try { recorder.stop(); } catch (Exception ignored) {}
                try { player.stop(); } catch (Exception ignored) {}
                recorder.release();
                player.release();
            }
        }

        private float compress(float sample, float amount) {
            float sign = Math.signum(sample);
            float abs = Math.abs(sample);
            float threshold = 0.08f + (1f - amount) * 0.45f;
            if (abs <= threshold) {
                return sample * (1f + amount * 2.2f);
            }
            float over = abs - threshold;
            float ratio = 1f + amount * 10f;
            return sign * (threshold + over / ratio) * (1f + amount * 0.9f);
        }

        private float limit(float sample, float ceiling) {
            if (sample > ceiling) return ceiling + (float) Math.tanh((sample - ceiling) * 2.5f) * 0.04f;
            if (sample < -ceiling) return -ceiling + (float) Math.tanh((sample + ceiling) * 2.5f) * 0.04f;
            return sample;
        }

        private AudioRecord createRecorder(int bufferBytes) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return new AudioRecord.Builder()
                        .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(SAMPLE_RATE)
                                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build())
                        .setBufferSizeInBytes(bufferBytes)
                        .build();
            }
            return new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferBytes
            );
        }

        private AudioTrack createPlayer(int bufferBytes) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(SAMPLE_RATE)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build())
                        .setBufferSizeInBytes(bufferBytes)
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build();
            }
            return new AudioTrack(
                    android.media.AudioManager.STREAM_MUSIC,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferBytes,
                    AudioTrack.MODE_STREAM
            );
        }
    }

    private static float dbToGain(float db) {
        return (float) Math.pow(10, db / 20f);
    }

    private static class Biquad {
        private final float sampleRate;
        private float b0, b1, b2, a1, a2;
        private float z1, z2;

        private Biquad(float sampleRate) {
            this.sampleRate = sampleRate;
        }

        static Biquad highpass(float sr, float freq, float q) {
            Biquad b = new Biquad(sr);
            b.updateHighpass(freq);
            return b;
        }

        static Biquad peaking(float sr, float freq, float q, float gainDb) {
            Biquad b = new Biquad(sr);
            b.updatePeaking(freq, q, gainDb);
            return b;
        }

        static Biquad highShelf(float sr, float freq, float gainDb) {
            Biquad b = new Biquad(sr);
            b.updateHighShelf(freq, gainDb);
            return b;
        }

        void updateHighpass(float freq) {
            float omega = (float) (2 * Math.PI * freq / sampleRate);
            float cos = (float) Math.cos(omega);
            float sin = (float) Math.sin(omega);
            float alpha = sin / 1.4f;
            float nb0 = (1 + cos) / 2;
            float nb1 = -(1 + cos);
            float nb2 = (1 + cos) / 2;
            float na0 = 1 + alpha;
            float na1 = -2 * cos;
            float na2 = 1 - alpha;
            set(nb0, nb1, nb2, na0, na1, na2);
        }

        void updatePeaking(float freq, float q, float gainDb) {
            float a = (float) Math.pow(10, gainDb / 40f);
            float omega = (float) (2 * Math.PI * freq / sampleRate);
            float cos = (float) Math.cos(omega);
            float sin = (float) Math.sin(omega);
            float alpha = sin / (2 * q);
            set(1 + alpha * a, -2 * cos, 1 - alpha * a,
                    1 + alpha / a, -2 * cos, 1 - alpha / a);
        }

        void updateHighShelf(float freq, float gainDb) {
            float a = (float) Math.pow(10, gainDb / 40f);
            float omega = (float) (2 * Math.PI * freq / sampleRate);
            float cos = (float) Math.cos(omega);
            float sin = (float) Math.sin(omega);
            float beta = (float) Math.sqrt(a) / 0.707f;
            set(a * ((a + 1) + (a - 1) * cos + beta * sin),
                    -2 * a * ((a - 1) + (a + 1) * cos),
                    a * ((a + 1) + (a - 1) * cos - beta * sin),
                    (a + 1) - (a - 1) * cos + beta * sin,
                    2 * ((a - 1) - (a + 1) * cos),
                    (a + 1) - (a - 1) * cos - beta * sin);
        }

        private void set(float nb0, float nb1, float nb2, float na0, float na1, float na2) {
            b0 = nb0 / na0;
            b1 = nb1 / na0;
            b2 = nb2 / na0;
            a1 = na1 / na0;
            a2 = na2 / na0;
        }

        float process(float in) {
            float out = in * b0 + z1;
            z1 = in * b1 + z2 - a1 * out;
            z2 = in * b2 - a2 * out;
            return out;
        }
    }
}
