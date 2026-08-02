import {
  OperationGate,
  type OperationToken,
} from "./operationGate";

export type StartOperationResult = "started" | "stale";

type GuardedStartOptions = {
  gate: OperationGate;
  constraints: MediaStreamConstraints;
  getUserMedia: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  onStreamAcquired?: (
    stream: MediaStream,
    isCurrent: () => boolean,
  ) => Promise<void>;
  startEngine: (stream: MediaStream) => Promise<void>;
  prepare?: () => Promise<void>;
};

function isStale(gate: OperationGate, token: OperationToken) {
  return !gate.isCurrent(token);
}

export async function runGuardedStart({
  gate,
  constraints,
  getUserMedia,
  onStreamAcquired,
  startEngine,
  prepare,
}: GuardedStartOptions): Promise<StartOperationResult> {
  const token = gate.begin();
  let stream: MediaStream | null = null;
  let engineOwnsStream = false;

  try {
    await prepare?.();
    if (isStale(gate, token)) return "stale";

    stream = await getUserMedia(constraints);
    if (isStale(gate, token)) {
      stream.getTracks().forEach((track) => track.stop());
      return "stale";
    }

    await onStreamAcquired?.(stream, () => gate.isCurrent(token));
    if (isStale(gate, token)) {
      stream.getTracks().forEach((track) => track.stop());
      return "stale";
    }

    // From this point the engine owns the stream and its cleanup.
    engineOwnsStream = true;
    await startEngine(stream);
    return isStale(gate, token) ? "stale" : "started";
  } catch (error) {
    if (stream && !engineOwnsStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (isStale(gate, token)) return "stale";
    throw error;
  }
}
