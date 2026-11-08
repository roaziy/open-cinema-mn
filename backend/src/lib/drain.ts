/**
 * Process-wide drain flag, set once when shutdown starts and never cleared. Loops that call the
 * payment provider check it before each next item, so the drain only waits for calls already in
 * flight; whatever is left (owed refunds, unsettled invoices) the sweeper picks up after restart.
 */
let draining = false;

export function startDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}
