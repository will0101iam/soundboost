import { describe, expect, test, vi } from "vitest";
import { OperationGate } from "./operationGate";
import {
  runLatestDeviceRefresh,
  runLatestOutputSelection,
} from "./deviceRefresh";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("runLatestDeviceRefresh", () => {
  test("刷新等待期间失效时不应用晚返回结果", async () => {
    const gate = new OperationGate();
    const refresh = deferred<string[]>();
    const apply = vi.fn();

    const operation = runLatestDeviceRefresh({
      gate,
      load: () => refresh.promise,
      apply,
    });
    gate.invalidate();
    refresh.resolve(["late-device"]);

    await expect(operation).resolves.toBe("stale");
    expect(apply).not.toHaveBeenCalled();
  });

  test("并发刷新只有最后一次结果生效", async () => {
    const gate = new OperationGate();
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const apply = vi.fn();

    const firstOperation = runLatestDeviceRefresh({
      gate,
      load: () => first.promise,
      apply,
    });
    const secondOperation = runLatestDeviceRefresh({
      gate,
      load: () => second.promise,
      apply,
    });

    second.resolve(["new-device"]);
    await expect(secondOperation).resolves.toBe("applied");
    first.resolve(["old-device"]);
    await expect(firstOperation).resolves.toBe("stale");

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(["new-device"]);
  });

  test("失效刷新晚返回错误时不触发错误处理", async () => {
    const gate = new OperationGate();
    const refresh = deferred<string[]>();
    const apply = vi.fn();
    const fail = vi.fn();

    const operation = runLatestDeviceRefresh({
      gate,
      load: () => refresh.promise,
      apply,
      fail,
    });
    gate.invalidate();
    const staleError = new Error("late refresh failed");
    const rejection = Promise.reject(staleError);
    rejection.catch(() => undefined);
    refresh.resolve(rejection);

    await expect(operation).resolves.toBe("stale");
    expect(apply).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  test("当前刷新失败时在 token 保护内处理错误", async () => {
    const gate = new OperationGate();
    const refreshError = new Error("refresh failed");
    const fail = vi.fn();

    const operation = runLatestDeviceRefresh({
      gate,
      load: async () => {
        throw refreshError;
      },
      apply: vi.fn(),
      fail,
    });

    await expect(operation).resolves.toBe("failed");
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(refreshError);
  });
});

describe("runLatestOutputSelection", () => {
  test("显式输出授权会让此前在途设备刷新失效且只应用一次", async () => {
    const refreshGate = new OperationGate();
    const selectionGate = new OperationGate();
    const refresh = deferred<string[]>();
    const refreshApply = vi.fn();
    const selectionApply = vi.fn();

    const refreshOperation = runLatestDeviceRefresh({
      gate: refreshGate,
      load: () => refresh.promise,
      apply: refreshApply,
    });
    const selectionOperation = runLatestOutputSelection({
      refreshGate,
      selectionGate,
      select: async () => "airpods",
      apply: selectionApply,
    });

    await expect(selectionOperation).resolves.toBe("applied");
    refresh.resolve(["system-default"]);
    await expect(refreshOperation).resolves.toBe("stale");

    expect(selectionApply).toHaveBeenCalledTimes(1);
    expect(selectionApply).toHaveBeenCalledWith("airpods");
    expect(refreshApply).not.toHaveBeenCalled();
  });

  test("输出 chooser 等待期间启动的设备刷新也会在授权成功时失效", async () => {
    const refreshGate = new OperationGate();
    const selectionGate = new OperationGate();
    const chooser = deferred<string>();
    const refresh = deferred<string[]>();
    const refreshApply = vi.fn();
    const selectionApply = vi.fn();

    const selectionOperation = runLatestOutputSelection({
      refreshGate,
      selectionGate,
      select: () => chooser.promise,
      apply: selectionApply,
    });
    const refreshOperation = runLatestDeviceRefresh({
      gate: refreshGate,
      load: () => refresh.promise,
      apply: refreshApply,
    });

    chooser.resolve("airpods");
    await expect(selectionOperation).resolves.toBe("applied");
    refresh.resolve(["system-default"]);
    await expect(refreshOperation).resolves.toBe("stale");

    expect(selectionApply).toHaveBeenCalledTimes(1);
    expect(refreshApply).not.toHaveBeenCalled();
  });

  test("并发输出 chooser 只有最后一次选择可以覆盖设备", async () => {
    const refreshGate = new OperationGate();
    const selectionGate = new OperationGate();
    const first = deferred<string>();
    const second = deferred<string>();
    const apply = vi.fn();

    const firstOperation = runLatestOutputSelection({
      refreshGate,
      selectionGate,
      select: () => first.promise,
      apply,
    });
    const secondOperation = runLatestOutputSelection({
      refreshGate,
      selectionGate,
      select: () => second.promise,
      apply,
    });

    second.resolve("new-airpods");
    await expect(secondOperation).resolves.toBe("applied");
    first.resolve("old-airpods");
    await expect(firstOperation).resolves.toBe("stale");

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("new-airpods");
  });
});
