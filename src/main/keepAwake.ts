/** Keep the system awake while an agent is busy — Windows analog of `caffeinate`. */

const koffi = require('koffi');

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let setThreadExecutionState: ((flags: number) => number) | null = null;
let active = false;

function getImpl(): ((flags: number) => number) | null {
  if (setThreadExecutionState) return setThreadExecutionState;
  try {
    const lib = koffi.load('kernel32.dll');
    setThreadExecutionState = lib.func('uint32 SetThreadExecutionState(uint32 esFlags)');
  } catch {
    setThreadExecutionState = null;
  }
  return setThreadExecutionState;
}

export function isKeepAwakeActive(): boolean {
  return active;
}

export function setKeepAwake(on: boolean): void {
  const fn = getImpl();
  if (!fn) return;
  const flags = on ? ES_CONTINUOUS | ES_SYSTEM_REQUIRED : ES_CONTINUOUS;
  try {
    fn(flags);
    active = on;
  } catch {
    /* ignore FFI errors */
  }
}
