# Android RNNoise 实时扩音设计

## 背景

Web 验证显示 RNNoise 能降低背景噪声，但在部分输入上会把连续快速语音误判为噪声。Android 版必须保留 RNNoise，同时增加语音保护和可靠降级，且不得破坏上一个可安装版本的华为兼容范围。

## 目标

- 使用手机内置麦克风采集，声音输出到系统当前蓝牙媒体设备。
- 在 Android 原生音频线程中使用 RNNoise 实时降噪。
- 避免低 VAD 时吞掉连续语音。
- 保持 Android 5.0、32 位 ARM 和 64 位 ARM 兼容。
- GitHub Actions 可重复构建并上传 debug APK。

## 非目标

- 不支持 HarmonyOS NEXT 原生应用。
- 不保证蓝牙麦克风输入质量；蓝牙麦克风通常会触发 HFP 通话模式。
- 不提供医疗级助听、听力验配或耳机声压安全保证。
- 本阶段不实现后台常驻服务。

## 音频链路

```text
手机内置麦克风 / 48 kHz / mono / PCM 16-bit
-> RNNoise JNI / 480 samples
-> 语音保护
-> 高通滤波
-> 轻度人声 presence
-> 温和压缩
-> 输出增益
-> 数字样本峰值保护
-> AudioTrack / 当前系统媒体输出
```

RNNoise 必须在 EQ、压缩和增益之前工作。

## RNNoise 集成

- 固定使用 Xiph RNNoise `v0.1.1`，peeled commit
  `6cbfd53eb348a8d394e0757b4025c6ded34eb2b6`。
- 使用该提交 `src/rnn_data.c` 内嵌的经典小模型，不依赖外部模型
  archive。小模型是移动端兼容边界，避免把 main 分支的大模型带入 APK
  与 Git 历史。
- 将 `Makefile.am` 列出的 7 个核心源、传递依赖头和 BSD 3-Clause
  许可证直接纳入仓库。
- GitHub Actions 构建期间不下载 RNNoise 源码或模型。
- 使用 CMake 将核心构建为 C99/PIC 的 `rnnoise_core` 静态库；JNI 桥在
  后续任务中单独链接。
- 仅打包 `arm64-v8a` 和 `armeabi-v7a`，覆盖新旧华为 ARM 手机。
- Java 层复用固定大小的 `short[480]` 输入输出帧，避免实时循环持续分配。
- JNI 返回 RNNoise VAD 概率，Java 层负责语音保护策略。

## 语音保护

RNNoise 开关默认开启，但不能成为唯一音频路径。

- 当 VAD 足够高时，主要使用 RNNoise 输出。
- 当 VAD 较低但原始帧能量明显高于噪声底时，混回受控比例的原始语音。
- 使用不同的进入和退出阈值以及短暂保持时间，避免每帧来回切换。
- RNNoise 关闭、初始化失败或运行异常时，立即旁路到原始 PCM，不中断扩音。

## Android 兼容

- `applicationId`: `com.local.soundboost`
- `minSdk`: 21
- `targetSdk`: 35
- `versionCode`: 3
- `versionName`: `0.2.0`
- Android 6.0 及以上优先请求内置麦克风路由。
- Android 5.0 保持旧构造 API 和系统默认路由。
- RNNoise 原生处理要求 48 kHz；设备无法初始化 48 kHz 时，回退到可用采样率并禁用 RNNoise。
- 不依赖 AndroidX，不新增运行时网络权限。

## DSP 调整

- 默认增益降为 `+3 dB`，最大 `+12 dB`。
- 当前压缩函数会直接放大低电平样本，需要替换为只处理超过阈值部分的温和压缩。
- 人声增强保持克制，避免连续语音高频刺耳。
- 最终样本必须钳制在配置的数字峰值范围内。
- UI 明确数字峰值不代表耳机声压安全。

## 生命周期与错误处理

- 音频线程启动失败时释放 AudioRecord、AudioTrack 和 RNNoise native state。
- 停止时先让循环退出，再释放 Java 和 JNI 资源。
- JNI 初始化或处理异常只禁用 RNNoise，不让 App 崩溃。
- 状态栏显示 RNNoise 是否生效、是否已回退以及实际输入/输出路由。

## 构建与签名

- GitHub Actions 固定 Java 17、Gradle、NDK 和 CMake 版本。
- Action 运行 Java 测试、native 编译和 `assembleDebug`。
- 上传 `app-debug.apk` 为 `soundboost-debug-apk` artifact。
- debug APK 可用于首次安装测试。
- 若 GitHub Runner 生成的 debug 签名与旧包不同，需要先卸载旧包；要无损覆盖升级，后续需配置稳定 release keystore 和 GitHub Secrets。

## 验证

- Java 单元测试覆盖帧聚合、语音保护、压缩和参数边界。
- native 构建必须同时产出 `armeabi-v7a` 与 `arm64-v8a`。
- Web 测试、TypeScript 检查和构建继续通过。
- GitHub Actions 成功生成 APK 后才视为打包完成。
- 华为真机先验证安装、权限、手机麦克风输入、蓝牙媒体输出和连续长句清晰度。
