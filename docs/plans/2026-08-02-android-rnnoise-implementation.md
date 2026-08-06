# Android RNNoise Realtime Amplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在保持 Android 5.0 与华为 ARM 手机兼容的前提下，为原生 APK 增加 RNNoise、连续语音保护、内置麦克风优先路由和可重复的 GitHub Actions 打包流程。

**Architecture:** 固定 vendoring Xiph RNNoise 源码与模型，通过 CMake/JNI 暴露 480-sample 帧处理 API；Java 层负责帧聚合、VAD 语音保护、DSP 和生命周期。RNNoise 或 48 kHz 初始化失败时自动旁路，应用仍可扩音。

**Tech Stack:** Java、Android AudioRecord/AudioTrack、Android NDK、CMake、JNI、Xiph RNNoise、JUnit 4、GitHub Actions

---

## 执行规则

- 使用 `@test-driven-development`：Java 行为先写失败测试，再实现。
- 使用 `@verification-before-completion`：每个提交前运行对应测试或构建检查。
- 不添加 `Co-Authored-By`。
- 保持 `applicationId`、`minSdk 21`、Android 5 兼容分支和旧构造 API。
- native 异常只能触发 RNNoise 旁路，不能让实时扩音崩溃。

### Task 1: 固化当前 Web 实现

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `src/audio/*.ts`
- Create: `src/audio/*.test.ts`
- Create: `src/types/simple-rnnoise-wasm.d.ts`
- Create: `src/vite-env.d.ts`
- Create: `tsconfig.json`

**Step 1: 验证当前 Web 基线**

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: `70/70` 测试通过，类型检查和 Vite 构建成功，无调试插桩与 `.dbg` 文件。

**Step 2: 提交 Web 实现**

```bash
git add package.json package-lock.json src tsconfig.json
git commit -m "feat: add RNNoise realtime web audio"
```

### Task 2: 建立 Android 单元测试与版本配置

**Files:**
- Modify: `android-app/app/build.gradle`
- Create: `android-app/app/src/test/java/com/local/soundboost/SpeechProtectionTest.java`

**Step 1: 写失败测试**

测试要求：

```java
@Test
public void preservesDrySpeechWhenVadIsLowButEnergyIsActive() {
    SpeechProtection protection = new SpeechProtection();
    float mix = protection.dryMixFor(0.05f, 0.08f);
    assertTrue(mix >= 0.30f);
}

@Test
public void usesMostlyDenoisedSignalWhenVadIsHigh() {
    SpeechProtection protection = new SpeechProtection();
    assertEquals(0f, protection.dryMixFor(0.8f, 0.08f), 0.001f);
}
```

**Step 2: 验证 RED**

Run:

```bash
cd android-app
gradle :app:testDebugUnitTest
```

Expected: FAIL，`SpeechProtection` 尚不存在。

**Step 3: 更新构建配置**

- `versionCode 3`
- `versionName "0.2.0"`
- 保持 `minSdk 21`
- 增加 JUnit 4
- 增加 CMake、NDK 和 ARM 双 ABI 配置

**Step 4: 暂不实现生产逻辑**

此任务只建立测试和构建入口。

### Task 3: Vendor 固定 RNNoise 源码与模型

**Files:**
- Create: `android-app/app/src/main/cpp/CMakeLists.txt`
- Create: `android-app/app/src/main/cpp/rnnoise/include/rnnoise.h`
- Create: `android-app/app/src/main/cpp/rnnoise/src/*`
- Create: `android-app/app/src/main/cpp/rnnoise/COPYING`
- Create: `android-app/app/src/main/cpp/rnnoise/UPSTREAM.md`

**Step 1: 获取固定源码**

从 Xiph RNNoise `v0.1.1` 的 peeled commit：

```text
6cbfd53eb348a8d394e0757b4025c6ded34eb2b6
```

复制 `Makefile.am` 列出的 7 个库源文件及其传递依赖头文件，不复制
仓库元数据、训练代码、示例或架构专用源码。

**Step 2: 固化模型**

直接纳入该提交 `src/rnn_data.c` 中内嵌的经典小模型，不下载或生成外部
模型 archive。选择经典小模型是移动端兼容边界：vendor 目录保持在约
2 MiB 以内，避免 main 分支大模型增加 APK 体积和 Git 历史负担。

**Step 3: 写 CMake**

- 只定义 `rnnoise_core` 静态库，编译 7 个经典 RNNoise C 源。
- 使用 C99、PIC、公开/私有 include 路径并链接 `m`。
- 本任务不引用 JNI、Android `log` 或架构专用源码。

**Step 4: 检查许可证和来源**

`UPSTREAM.md` 记录 `v0.1.1`、peeled commit、内嵌模型、vendored
文件范围和 BSD 3-Clause 许可证。

### Task 4: 实现 JNI RNNoise 桥

**Files:**
- Create: `android-app/app/src/main/cpp/rnnoise_jni.c`
- Create: `android-app/app/src/main/java/com/local/soundboost/RnnoiseBridge.java`

**Step 1: 定义 Java API**

```java
final class RnnoiseBridge {
    static final int FRAME_SIZE = 480;
    static boolean isAvailable();
    static long create();
    static float process(long handle, short[] input, short[] output);
    static void destroy(long handle);
}
```

**Step 2: 实现 JNI**

- `create()` 返回 native state 指针。
- `process()` 验证数组长度为 480。
- 将 PCM16 转为 RNNoise 使用的 float PCM 标度。
- 调用 `rnnoise_process_frame()`，返回 VAD。
- 将结果饱和转换回 PCM16。
- `destroy()` 可重复安全调用。

**Step 3: native 失败安全**

Java `static` 初始化捕获 `UnsatisfiedLinkError`；不可用时返回 false，业务层走旁路。

### Task 5: 实现语音保护和帧处理器

**Files:**
- Create: `android-app/app/src/main/java/com/local/soundboost/SpeechProtection.java`
- Create: `android-app/app/src/main/java/com/local/soundboost/RnnoiseFrameProcessor.java`
- Create: `android-app/app/src/test/java/com/local/soundboost/RnnoiseFrameProcessorTest.java`

**Step 1: 完成 SpeechProtection RED-GREEN**

规则：

- 高 VAD：主要使用 RNNoise。
- 低 VAD 且原始 RMS 高于噪声底：至少混回 30% 原始信号。
- 使用进入/退出阈值和保持帧数，避免快速抖动。
- 数值钳制在 PCM16 范围内。

**Step 2: 测试帧聚合**

- 任意长度 PCM 输入按 480 样本聚合。
- 不丢样本、不重复样本。
- native 不可用或处理抛错时旁路。
- 处理循环复用数组。

**Step 3: 实现 RnnoiseFrameProcessor**

通过可注入的 `Denoiser` 接口测试，不在 JVM 单测中加载 `.so`。

### Task 6: 集成 Android 实时音频链路

**Files:**
- Modify: `android-app/app/src/main/java/com/local/soundboost/MainActivity.java`

**Step 1: 调整安全默认值**

- 默认增益 `+3 dB`
- 最大增益 `+12 dB`
- 自然预设以连续语音清晰为主
- 数字峰值文案不承诺声压安全

**Step 2: 集成 RNNoise**

- AudioRecord 成功后创建 `RnnoiseFrameProcessor`。
- RNNoise 位于 EQ、压缩和增益前。
- UI 增加 RNNoise 开关和当前状态。
- 停止时销毁 native state。

**Step 3: 修正压缩**

低于阈值的样本保持线性；只压缩超出阈值部分，不再对全部低电平样本额外放大。

**Step 4: 路由与采样率**

- Android 6+ 优先 `TYPE_BUILTIN_MIC`。
- 输出保持 `USAGE_MEDIA`，跟随系统蓝牙媒体路由。
- 优先 48 kHz；失败时回退 44.1 kHz 并禁用 RNNoise。
- Android 5 保留旧构造路径。

**Step 5: 权限与状态**

授权后自动继续启动；错误状态明确显示 RNNoise 旁路原因。

### Task 7: 固化 GitHub Actions 与文档

**Files:**
- Modify: `.github/workflows/android-debug-apk.yml`
- Modify: `android-app/README.md`

**Step 1: 固定 native 工具链**

Actions 安装：

```text
Java 17
NDK 27.0.12077973
CMake 3.22.1
Gradle 8.10.2
```

**Step 2: 执行验证**

```bash
gradle :app:testDebugUnitTest :app:assembleDebug
```

**Step 3: 验证双 ABI**

使用 `unzip -l` 检查 APK 同时包含：

```text
lib/armeabi-v7a/libsoundboost_rnnoise.so
lib/arm64-v8a/libsoundboost_rnnoise.so
```

**Step 4: 更新文档**

说明：

- 华为 Android / HarmonyOS 兼容范围
- 手机麦克风输入、蓝牙媒体输出
- Actions 手动打包与下载
- 首次安装与覆盖安装的签名差异
- RNNoise 旁路和连续语音测试

### Task 8: 最终验证、提交与上传

**Files:**
- All implementation files

**Step 1: 本地可执行验证**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

若本机具备 Android 工具链，再运行：

```bash
cd android-app
gradle :app:testDebugUnitTest :app:assembleDebug
```

**Step 2: 提交**

提交拆分：

```text
feat: add native RNNoise Android bridge
feat: preserve continuous speech on Android
ci: build ARM Android APK
docs: document Huawei APK installation
```

所有提交禁止 `Co-Authored-By`。

**Step 3: 推送分支**

```bash
git push -u origin fix/rnnoise-realtime
```

**Step 4: 验证 GitHub Actions**

确认 `Android debug APK` 成功，并检查 artifact 名称 `soundboost-debug-apk`。

**Step 5: 合并策略**

Actions 成功后再决定是否合并到 `main`，不在构建失败时污染主分支。
