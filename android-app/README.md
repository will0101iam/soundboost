# 声音增强 Android 原型

这是一个用于验证的本地 Android APK 工程，目标是先测试：

```text
手机麦克风
→ RNNoise 实时降噪
→ 连续语音保护
→ 低频过滤
→ 人声清晰度增强
→ 温和动态压缩
→ 总音量增益
→ 数字峰值保护
→ 系统当前蓝牙媒体输出
```

## 兼容范围

- vivo：普通 Android 系统，优先走这个 APK 版本。当前最低支持 Android 5.0。
- 华为：如果手机可以安装普通 APK，也优先走这个版本。当前最低支持 Android 5.0。
- HarmonyOS NEXT：不兼容普通 APK，需要单独做 ArkTS / OHAudio 原生鸿蒙版本。

APK 包含 `arm64-v8a` 和 `armeabi-v7a`，适用于新旧 ARM 架构华为手机。
不包含 x86 模拟器版本。

App 在 Android 6.0 及以上优先使用手机内置麦克风，声音走系统当前媒体输出。
测试蓝牙或骨传导耳机时：

1. 先在手机系统蓝牙设置中连接耳机。
2. 确认“媒体音频”已开启。
3. 不要把蓝牙耳机麦克风作为输入，否则通常会切换到低带宽通话模式。
4. 再打开 App 并点击“开始”。

RNNoise 要求 `48 kHz`。设备不支持时 App 会回退到 `44.1 kHz` 并自动旁路
RNNoise，实时扩音仍可继续。

## 用 Android Studio 运行

1. 安装 Android Studio。
2. 打开 `android-app` 文件夹。
3. 等 Gradle Sync 完成。
4. 手机打开开发者选项和 USB 调试。
5. 点击 Run，安装到 vivo 或华为手机。

本地构建需要：

- JDK 17
- Android SDK 35
- Android Build Tools 35.0.0
- Android NDK 27.0.12077973
- CMake 3.22.1
- Gradle 8.10.2

命令行构建：

```bash
cd android-app
gradle :app:testDebugUnitTest :app:assembleDebug
```

APK 输出路径：

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

`minSdk` 保持为 21，对应 Android 5.0。不要为了本地 SDK 缺失随意提高
`minSdk`，否则会破坏旧华为手机兼容性。

## 不在本地安装 Android SDK，在线打 APK

推荐用 GitHub Actions。仓库根目录已经有：

```text
.github/workflows/android-debug-apk.yml
```

使用方式：

1. 打开 GitHub 仓库 `will0101iam/soundboost`。
2. 进入 `Actions`。
3. 选择 `Android debug APK`。
4. 点 `Run workflow`，选择需要构建的分支。
5. 等待测试、NDK 编译、双 ABI 检查全部完成。
6. 打开成功的运行记录。
7. 在 `Artifacts` 下载 `soundboost-debug-apk`。
8. 解压得到 `app-debug.apk`。

当前 RNNoise 分支：

```text
fix/rnnoise-realtime
```

## 在华为手机安装

1. 把 `app-debug.apk` 传到手机。
2. 在系统设置中允许文件管理器或浏览器“安装未知应用”。
3. 点击 APK 并完成安装。
4. 如果系统提示“签名不一致”或无法覆盖旧版，先卸载旧版再安装。
5. 首次打开时允许麦克风权限。

GitHub Runner 每次生成的 debug 签名不保证与旧 APK 一致，因此 debug 包不承诺
无损覆盖升级。正式发布或保留应用数据升级，需要配置固定 release keystore 和
GitHub Secrets。

这个 debug APK 适合自己测试，不适合直接发布应用市场。发布版需要正式签名 keystore。

## 测试建议

第一次测试一定戴耳机，并从低音量开始。不要用手机扬声器靠近麦克风测试，否则容易回授啸叫。

建议测试顺序：

1. 点“开始”，授权麦克风。
2. 状态应显示“输入 手机麦克风”，输出应为蓝牙媒体耳机或系统蓝牙设备。
3. 先用“自然”，连续说一个较长句子，确认词组不会被吞掉。
4. 关闭 RNNoise 重复同一句，进行 A/B 对比。
5. 再点“明显变响”，确认音量变大但没有明显破音。
6. 如果刺耳，降低“清晰度”或把“数字峰值上限”调到 `-12 dBFS`。

## 当前限制

- 这是技术验证版，不是医疗级助听器。
- 数字峰值限制不代表耳机声压安全。
- 蓝牙延迟取决于手机和耳机，App 不能完全消除。
- 暂时不做后台常驻、自动连接和听力图验配。
- vivo、华为各机型音频路由策略可能不同，需要真机实测。
