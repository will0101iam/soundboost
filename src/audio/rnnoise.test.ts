import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAssets: vi.fn(),
  register: vi.fn(),
}));

vi.mock("simple-rnnoise-wasm", () => ({
  rnnoise_loadAssets: mocks.loadAssets,
  RNNoiseNode: class {
    static register = mocks.register;

    constructor(readonly context: AudioContext) {}
  },
}));

vi.mock("simple-rnnoise-wasm/rnnoise.wasm?url&no-inline", () => ({
  default: "/assets/rnnoise.wasm",
}));

vi.mock("simple-rnnoise-wasm/rnnoise.worklet.js?url&no-inline", () => ({
  default: "/assets/rnnoise.worklet.js",
}));

describe("createRnnoiseNode", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadAssets.mockReset();
    mocks.register.mockReset();
  });

  test("reuses compiled assets when a later context registration fails", async () => {
    const assets = ["/assets/rnnoise.js", Promise.resolve({})];
    const registrationError = new Error("worklet registration failed");
    const firstContext = { id: "first" } as unknown as AudioContext;
    const secondContext = { id: "second" } as unknown as AudioContext;

    mocks.loadAssets.mockReturnValue(assets);
    mocks.register
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(registrationError)
      .mockResolvedValueOnce(undefined);

    const { createRnnoiseNode } = await import("./rnnoise");

    await createRnnoiseNode(firstContext);
    await expect(createRnnoiseNode(secondContext)).rejects.toBe(registrationError);
    const node = await createRnnoiseNode(secondContext);

    expect(mocks.loadAssets).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenNthCalledWith(1, firstContext, assets);
    expect(mocks.register).toHaveBeenNthCalledWith(2, secondContext, assets);
    expect(mocks.register).toHaveBeenNthCalledWith(3, secondContext, assets);
    expect(node).toMatchObject({ context: secondContext });
  });
});
