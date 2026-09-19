// Node-side stand-in so pure functions in modules that also define a Durable Object can be unit-tested
// without the Workers runtime. The DO itself is exercised against production by scripts/simulate-call.sh.
export class DurableObject<E = unknown> {
  constructor(public ctx: unknown, public env: E) {}
}
