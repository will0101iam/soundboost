import { describe, expect, test, vi } from "vitest";
import { createCachedAssetLoader } from "./cachedAssetLoader";

describe("createCachedAssetLoader", () => {
  test("loads assets once and reuses the cached value", () => {
    const assets = ["worklet.js", Promise.resolve({})] as const;
    const factory = vi.fn(() => assets);
    const loader = createCachedAssetLoader(factory);

    expect(loader.load()).toBe(assets);
    expect(loader.load()).toBe(assets);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("loads fresh assets after the cached module rejects", async () => {
    const moduleError = new Error("WASM compilation failed");
    const failedModule = Promise.reject(moduleError);
    const retryAssets = ["retry-worklet.js", Promise.resolve({})] as const;
    const factory = vi
      .fn()
      .mockReturnValueOnce(["failed-worklet.js", failedModule] as const)
      .mockReturnValueOnce(retryAssets);
    const loader = createCachedAssetLoader(factory);

    const firstAssets = loader.load();
    await expect(firstAssets[1]).rejects.toBe(moduleError);

    expect(loader.load()).toBe(retryAssets);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
