import { OperationGate } from "./operationGate";

type LatestDeviceRefreshOptions<T> = {
  gate: OperationGate;
  load: () => Promise<T>;
  apply: (value: T) => void;
  fail?: (error: unknown) => void;
};

export type DeviceRefreshResult = "applied" | "failed" | "stale";

export async function runLatestDeviceRefresh<T>({
  gate,
  load,
  apply,
  fail,
}: LatestDeviceRefreshOptions<T>): Promise<DeviceRefreshResult> {
  const token = gate.begin();

  try {
    const value = await load();
    if (!gate.isCurrent(token)) return "stale";

    apply(value);
    return "applied";
  } catch (error) {
    if (!gate.isCurrent(token)) return "stale";
    if (fail) {
      fail(error);
      return "failed";
    }
    throw error;
  }
}

type LatestOutputSelectionOptions<T> = {
  refreshGate: OperationGate;
  selectionGate: OperationGate;
  select: () => Promise<T>;
  apply: (value: T) => void;
  fail?: (error: unknown) => void;
};

export async function runLatestOutputSelection<T>({
  refreshGate,
  selectionGate,
  select,
  apply,
  fail,
}: LatestOutputSelectionOptions<T>): Promise<DeviceRefreshResult> {
  const token = selectionGate.begin();

  try {
    const value = await select();
    if (!selectionGate.isCurrent(token)) return "stale";

    refreshGate.invalidate();
    apply(value);
    return "applied";
  } catch (error) {
    if (!selectionGate.isCurrent(token)) return "stale";
    if (fail) {
      fail(error);
      return "failed";
    }
    throw error;
  }
}
