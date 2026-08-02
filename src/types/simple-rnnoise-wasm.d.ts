declare module "simple-rnnoise-wasm" {
  export type RnnoiseAssets = [
    string | URL,
    Promise<WebAssembly.Module>,
  ];

  export function rnnoise_loadAssets(options?: {
    scriptSrc?: string | URL;
    moduleSrc?: string | BufferSource;
  }): RnnoiseAssets;

  export class RNNoiseNode extends AudioWorkletNode {
    constructor(context: AudioContext);

    static register(
      context: AudioContext,
      assets?: RnnoiseAssets,
    ): Promise<void>;

    onstatus: ((event: Event & { vadProb?: number }) => void) | null;

    update(mode?: boolean | "stat"): void;
  }
}
