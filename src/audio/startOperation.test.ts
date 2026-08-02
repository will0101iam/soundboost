import { describe, expect, test, vi } from "vitest";
import { OperationGate } from "./operationGate";
import { runGuardedStart } from "./startOperation";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createStream() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: vi.fn(() => [track]),
  } as unknown as MediaStream;
  return { stream, track };
}

describe("runGuardedStart", () => {
  test("A 过期完成不会停止已经成功的 B 会话", async () => {
    const gate = new OperationGate();
    const firstEngineStart = deferred<void>();
    const first = createStream();
    const second = createStream();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    const engine = {
      start: vi
        .fn()
        .mockImplementationOnce(() => firstEngineStart.promise)
        .mockResolvedValueOnce(undefined),
      stop: vi.fn(),
    };

    const firstOperation = runGuardedStart({
      gate,
      getUserMedia,
      constraints: { audio: true },
      startEngine: engine.start,
    });
    await vi.waitFor(() => {
      expect(engine.start).toHaveBeenCalledWith(first.stream);
    });

    const secondOperation = runGuardedStart({
      gate,
      getUserMedia,
      constraints: { audio: true },
      startEngine: engine.start,
    });
    await expect(secondOperation).resolves.toBe("started");

    firstEngineStart.resolve();
    await expect(firstOperation).resolves.toBe("stale");

    expect(engine.stop).not.toHaveBeenCalled();
    expect(second.track.stop).not.toHaveBeenCalled();
  });

  test("A 在获取媒体流后已经过期时只停止 A 自己的轨道", async () => {
    const gate = new OperationGate();
    const firstMedia = deferred<MediaStream>();
    const first = createStream();
    const second = createStream();
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(() => firstMedia.promise)
      .mockResolvedValueOnce(second.stream);
    const startEngine = vi.fn(async () => undefined);

    const firstOperation = runGuardedStart({
      gate,
      getUserMedia,
      constraints: { audio: true },
      startEngine,
    });
    await vi.waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
    const secondOperation = runGuardedStart({
      gate,
      getUserMedia,
      constraints: { audio: true },
      startEngine,
    });
    await expect(secondOperation).resolves.toBe("started");

    firstMedia.resolve(first.stream);
    await expect(firstOperation).resolves.toBe("stale");

    expect(first.track.stop).toHaveBeenCalledTimes(1);
    expect(second.track.stop).not.toHaveBeenCalled();
    expect(startEngine).toHaveBeenCalledTimes(1);
    expect(startEngine).toHaveBeenCalledWith(second.stream);
  });

  test("过期错误被忽略，当前操作的真实错误继续抛出", async () => {
    const gate = new OperationGate();
    const staleMedia = deferred<MediaStream>();
    const currentError = new Error("麦克风不可用");
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(() => staleMedia.promise)
      .mockRejectedValueOnce(currentError);

    const staleOperation = runGuardedStart({
      gate,
      getUserMedia,
      constraints: { audio: true },
      startEngine: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
    const currentOperation = runGuardedStart({
      gate,
      getUserMedia,
      constraints: { audio: true },
      startEngine: vi.fn(),
    });

    await expect(currentOperation).rejects.toBe(currentError);
    staleMedia.reject(new Error("过期权限错误"));
    await expect(staleOperation).resolves.toBe("stale");
  });

  test("媒体流获取后先执行回调，后续引擎失败也不影响设备枚举", async () => {
    const gate = new OperationGate();
    const { stream } = createStream();
    const engineError = new Error("RNNoise 加载失败");
    const onStreamAcquired = vi.fn(async () => undefined);
    const startEngine = vi.fn(async () => {
      throw engineError;
    });

    const operation = runGuardedStart({
      gate,
      constraints: { audio: true },
      getUserMedia: vi.fn(async () => stream),
      onStreamAcquired,
      startEngine,
    });

    await expect(operation).rejects.toBe(engineError);
    expect(onStreamAcquired).toHaveBeenCalledWith(
      stream,
      expect.any(Function),
    );
    expect(onStreamAcquired).toHaveBeenCalledBefore(startEngine);
  });

  test("媒体流回调等待期间过期时停止自己的轨道且不启动引擎", async () => {
    const gate = new OperationGate();
    const { stream, track } = createStream();
    const callback = deferred<void>();
    const onStreamAcquired = vi.fn(() => callback.promise);
    const startEngine = vi.fn(async () => undefined);

    const operation = runGuardedStart({
      gate,
      constraints: { audio: true },
      getUserMedia: vi.fn(async () => stream),
      onStreamAcquired,
      startEngine,
    });

    await vi.waitFor(() => {
      expect(onStreamAcquired).toHaveBeenCalledWith(
        stream,
        expect.any(Function),
      );
    });
    gate.invalidate();
    callback.resolve();

    await expect(operation).resolves.toBe("stale");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(startEngine).not.toHaveBeenCalled();
  });
});
