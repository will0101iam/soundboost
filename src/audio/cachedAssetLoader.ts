export function createCachedAssetLoader<
  T extends readonly [unknown, Promise<unknown>],
>(factory: () => T) {
  let cached: T | undefined;

  return {
    load() {
      if (cached) return cached;

      const assets = factory();
      cached = assets;
      void assets[1].catch(() => {
        if (cached === assets) {
          cached = undefined;
        }
      });
      return assets;
    },
  };
}
