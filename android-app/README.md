# 声音增强 Android 原型

这是一个用于验证的本地 Android APK 工程，目标是先测试：

```text
手机麦克风
→ 低频过滤
→ 人声清晰度增强
→ 动态压缩
→ 总音量增益
→ 最大输出保护
→ 当前音频输出设备
```

## 兼容范围

- vivo：普通 Android 系统，优先走这个 APK 版本。
- 华为：如果手机可以安装普通 APK，也优先走这个版本。
- HarmonyOS NEXT：不兼容普通 APK，需要单独做 ArkTS / OHAudio 原生鸿蒙版本。

第一版没有强制选择蓝牙设备，声音会走系统当前输出。测试骨传导耳机时，先在系统蓝牙里连接耳机，再打开 App。

## 用 Android Studio 运行

1. 安装 Android Studio。
2. 打开 `android-app` 文件夹。
3. 等 Gradle Sync 完成。
4. 手机打开开发者选项和 USB 调试。
5. 点击 Run，安装到 vivo 或华为手机。

如果 Android Studio 提示 SDK 版本不匹配，可以安装 Android SDK 35，或者把 `app/build.gradle` 里的 `compileSdk` 和 `targetSdk` 调成你本机已有版本。

## 不在本地安装 Android SDK，在线打 APK

推荐用 GitHub Actions。仓库根目录已经有：

```text
.github/workflows/android-debug-apk.yml
```

使用方式：

1. 把整个 `/Users/gtt/Desktop/sound` 项目上传到 GitHub 仓库。
2. 打开 GitHub 仓库页面。
3. 进入 `Actions`。
4. 选择 `Android debug APK`。
5. 点 `Run workflow`。
6. 等构建完成后，打开这次运行记录。
7. 在 `Artifacts` 里下载 `soundboost-debug-apk`。
8. 解压后得到 `app-debug.apk`，传到 vivo / 华为手机安装。

这个 debug APK 适合自己测试，不适合直接发布应用市场。发布版需要正式签名 keystore。

## 测试建议

第一次测试一定戴耳机，并从低音量开始。不要用手机扬声器靠近麦克风测试，否则容易回授啸叫。

建议测试顺序：

1. 点“开始”，授权麦克风。
2. 先用“自然”。
3. 再点“明显变响”，确认是否真的变大。
4. 再点“人声突出”，让别人离手机 0.5 米正常说话。
5. 如果刺耳，降低“清晰度”或把“保护上限”调得更低，比如 `-12 dB`。

## 当前限制

- 这是技术验证版，不是医疗级助听器。
- 蓝牙延迟取决于手机和耳机，App 不能完全消除。
- 第一版暂时不做后台常驻、自动连接、设备诊断、听力图验配。
- vivo、华为各机型音频路由策略可能不同，需要真机实测。
