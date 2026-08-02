import type { EngineState } from "./engine";

export type AudioDeviceOption = {
  id: string;
  label: string;
};

type AudioOutputSelectableMediaDevices = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

export type AudioOutputSelectionResult =
  | { supported: true; device: MediaDeviceInfo }
  | { supported: false };

export class AudioOutputDeviceError extends Error {
  readonly sourceError: unknown;

  constructor(sourceError: unknown) {
    super(toOutputDeviceErrorMessage(sourceError));
    this.name = "AudioOutputDeviceError";
    this.sourceError = sourceError;
  }
}

export function groupAudioDevices(devices: MediaDeviceInfo[]) {
  const inputs: AudioDeviceOption[] = [];
  const outputs: AudioDeviceOption[] = [];

  for (const device of devices) {
    if (device.kind === "audioinput") {
      inputs.push({
        id: device.deviceId,
        label: device.label || `麦克风 ${inputs.length + 1}`,
      });
    } else if (device.kind === "audiooutput") {
      outputs.push({
        id: device.deviceId,
        label: device.label || `输出设备 ${outputs.length + 1}`,
      });
    }
  }

  return { inputs, outputs };
}

export function normalizeDeviceSelection(
  selectedId: string,
  devices: AudioDeviceOption[],
) {
  if (devices.some((device) => device.id === selectedId)) {
    return selectedId;
  }
  return (
    devices.find((device) => device.id === "default")?.id ??
    devices[0]?.id ??
    ""
  );
}

export function normalizeOutputDeviceSelection(
  selectedId: string,
  devices: AudioDeviceOption[],
) {
  if (!selectedId) return "";
  return devices.some((device) => device.id === selectedId)
    ? selectedId
    : "";
}

export function shouldRestartForDeviceChange(state: EngineState) {
  return (
    state === "loading-model" ||
    state === "starting" ||
    state === "running"
  );
}

export function supportsAudioOutputSelection(
  mediaDevices: MediaDevices | undefined,
) {
  return (
    typeof (
      mediaDevices as AudioOutputSelectableMediaDevices | undefined
    )?.selectAudioOutput === "function"
  );
}

export async function selectAudioOutputDevice(
  mediaDevices: MediaDevices,
): Promise<AudioOutputSelectionResult> {
  const selectAudioOutput = (
    mediaDevices as AudioOutputSelectableMediaDevices
  ).selectAudioOutput;
  if (typeof selectAudioOutput !== "function") {
    return { supported: false };
  }

  const device = await selectAudioOutput.call(mediaDevices);
  return { supported: true, device };
}

export function mergeAudioOutputDevice(
  devices: AudioDeviceOption[],
  selected: MediaDeviceInfo,
) {
  const next = {
    id: selected.deviceId,
    label: selected.label || "已授权输出设备",
  };
  return [
    ...devices.filter((device) => device.id !== next.id),
    next,
  ];
}

export function toOutputDeviceErrorMessage(error: unknown) {
  const name =
    error instanceof DOMException || error instanceof Error
      ? error.name
      : "";

  if (name === "NotAllowedError") {
    return "输出设备未授权，请重新选择。";
  }
  if (name === "NotFoundError") {
    return "未找到可用输出设备，请检查蓝牙耳机连接。";
  }
  if (name === "AbortError") {
    return "输出设备切换失败，请重新选择。";
  }
  return "输出设备操作失败，请重新选择。";
}
