export type OperationToken = number;

export class OperationGate {
  private generation = 0;

  begin(): OperationToken {
    this.generation += 1;
    return this.generation;
  }

  invalidate() {
    this.generation += 1;
  }

  isCurrent(token: OperationToken) {
    return token === this.generation;
  }
}
