import {
  RNNoiseNode,
  rnnoise_loadAssets,
} from "simple-rnnoise-wasm";
import wasmUrl from "simple-rnnoise-wasm/rnnoise.wasm?url&no-inline";
import workletUrl from "simple-rnnoise-wasm/rnnoise.worklet.js?url&no-inline";
import { createCachedAssetLoader } from "./cachedAssetLoader";

const assetLoader = createCachedAssetLoader(() =>
  rnnoise_loadAssets({
    scriptSrc: workletUrl,
    moduleSrc: wasmUrl,
  }),
);

export async function createRnnoiseNode(context: AudioContext) {
  await RNNoiseNode.register(context, assetLoader.load());
  return new RNNoiseNode(context);
}
