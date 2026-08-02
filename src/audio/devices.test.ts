import { describe, expect, test, vi } from "vitest";
import {
  mergeAudioOutputDevice,
  groupAudioDevices,
  normalizeDeviceSelection,
  normalizeOutputDeviceSelection,
  selectAudioOutputDevice,
  shouldRestartForDeviceChange,
  supportsAudioOutputSelection,
  toOutputDeviceErrorMessage,
} from "./devices";

function mediaDevice(
  kind: MediaDeviceKind,
  deviceId: string,
  label = "",
) {
  return {
    kind,
    deviceId,
    label,
    groupId: "",
    toJSON: () => ({}),
  } as MediaDeviceInfo;
}

describe("groupAudioDevices", () => {
  test("仅保留音频设备并为匿名设备生成稳定标签", () => {
    const devices = [
      mediaDevice("audioinput", "in-1"),
      mediaDevice("videoinput", "camera-1", "Camera"),
      mediaDevice("audioinput", "in-2"),
      mediaDevice("audiooutput", "out-1"),
      mediaDevice("audiooutput", "out-2"),
    ];

    expect(groupAudioDevices(devices)).toEqual({
      inputs: [
        { id: "in-1", label: "麦克风 1" },
        { id: "in-2", label: "麦克风 2" },
      ],
      outputs: [
        { id: "out-1", label: "输出设备 1" },
        { id: "out-2", label: "输出设备 2" },
      ],
    });
  });

  test("保留真实设备名称和 deviceId", () => {
    const devices = [
      mediaDevice("audioinput", "airpods-mic", "AirPods 麦克风"),
      mediaDevice("audiooutput", "airpods-out", "AirPods"),
    ];

    expect(groupAudioDevices(devices)).toEqual({
      inputs: [{ id: "airpods-mic", label: "AirPods 麦克风" }],
      outputs: [{ id: "airpods-out", label: "AirPods" }],
    });
  });
});

describe("normalizeDeviceSelection", () => {
  const devices = [
    { id: "default", label: "系统默认" },
    { id: "airpods", label: "AirPods" },
  ];

  test("当前设备仍存在时保留选择", () => {
    expect(normalizeDeviceSelection("airpods", devices)).toBe("airpods");
  });

  test("当前设备消失时回退到 default，再回退到首个设备", () => {
    expect(normalizeDeviceSelection("missing", devices)).toBe("default");
    expect(
      normalizeDeviceSelection("missing", [
        { id: "usb", label: "USB Headset" },
      ]),
    ).toBe("usb");
  });

  test("没有设备时返回空选择", () => {
    expect(normalizeDeviceSelection("missing", [])).toBe("");
  });
});

describe("normalizeOutputDeviceSelection", () => {
  const devices = [
    { id: "default", label: "浏览器默认设备" },
    { id: "airpods", label: "AirPods" },
  ];

  test("空选择在设备列表更新后仍表示系统默认输出", () => {
    expect(normalizeOutputDeviceSelection("", devices)).toBe("");
  });

  test("用户显式选择的设备仍存在时保留选择", () => {
    expect(normalizeOutputDeviceSelection("airpods", devices)).toBe(
      "airpods",
    );
  });

  test("用户选择的设备消失时回到空系统默认而非首项", () => {
    expect(normalizeOutputDeviceSelection("missing", devices)).toBe("");
    expect(
      normalizeOutputDeviceSelection("missing", [
        { id: "usb", label: "USB Headset" },
      ]),
    ).toBe("");
  });
});

describe("shouldRestartForDeviceChange", () => {
  test.each([
    ["loading-model", true],
    ["starting", true],
    ["running", true],
    ["idle", false],
    ["error", false],
    ["stopping", false],
  ] as const)("%s 状态返回 %s", (state, expected) => {
    expect(shouldRestartForDeviceChange(state)).toBe(expected);
  });
});

describe("selectAudioOutputDevice", () => {
  test("API 可用时只在调用函数后请求并返回用户选择的输出设备", async () => {
    const selected = mediaDevice("audiooutput", "airpods", "AirPods");
    const selectAudioOutput = vi.fn(async () => selected);
    const mediaDevices = {
      selectAudioOutput,
    } as unknown as MediaDevices;

    expect(supportsAudioOutputSelection(mediaDevices)).toBe(true);
    expect(selectAudioOutput).not.toHaveBeenCalled();

    await expect(selectAudioOutputDevice(mediaDevices)).resolves.toEqual({
      supported: true,
      device: selected,
    });
    expect(selectAudioOutput).toHaveBeenCalledTimes(1);
  });

  test("API 不可用时返回明确 unsupported 结果", async () => {
    const mediaDevices = {} as MediaDevices;

    expect(supportsAudioOutputSelection(mediaDevices)).toBe(false);
    await expect(selectAudioOutputDevice(mediaDevices)).resolves.toEqual({
      supported: false,
    });
  });

  test("输出授权拒绝提示重新选择且不误报麦克风", () => {
    const message = toOutputDeviceErrorMessage(
      new DOMException("", "NotAllowedError"),
    );

    expect(message).toContain("输出设备未授权");
    expect(message).toContain("重新选择");
    expect(message).not.toContain("麦克风");
  });
});

describe("mergeAudioOutputDevice", () => {
  test("把授权返回的设备合并到列表且不产生重复项", () => {
    const current = [{ id: "default", label: "系统默认" }];
    const selected = mediaDevice("audiooutput", "airpods", "AirPods");

    expect(mergeAudioOutputDevice(current, selected)).toEqual([
      { id: "default", label: "系统默认" },
      { id: "airpods", label: "AirPods" },
    ]);
    expect(
      mergeAudioOutputDevice(
        [...current, { id: "airpods", label: "旧名称" }],
        selected,
      ),
    ).toEqual([
      { id: "default", label: "系统默认" },
      { id: "airpods", label: "AirPods" },
    ]);
  });
});
