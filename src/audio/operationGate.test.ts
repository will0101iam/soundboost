import { describe, expect, test } from "vitest";
import { OperationGate } from "./operationGate";

describe("OperationGate", () => {
  test("新操作会使旧 token 失效", () => {
    const gate = new OperationGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  test("invalidate 会使当前 token 失效", () => {
    const gate = new OperationGate();
    const current = gate.begin();

    gate.invalidate();

    expect(gate.isCurrent(current)).toBe(false);
    expect(gate.isCurrent(gate.begin())).toBe(true);
  });
});
