// three's CommonJS build (the one react-three-fiber loads on native) calls process.emitWarning
// at import time, which React Native's `process` does not have. Must be imported before three.
const proc = globalThis.process as { emitWarning?: (...args: unknown[]) => void } | undefined;
if (proc && typeof proc.emitWarning !== 'function') {
  proc.emitWarning = __DEV__ ? (...args) => console.warn(...args) : () => {};
}
