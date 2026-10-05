// SPDX-License-Identifier: Apache-2.0

let automaticWorkerTail: Promise<void> = Promise.resolve();

/** Serialize automatic heavy worker work without weakening the explicit busy guard. */
export function runSerializedAutomaticWorker<T>(
  work: () => Promise<T>,
  isCurrent: () => boolean = () => true,
): Promise<T | undefined> {
  const scheduled = automaticWorkerTail.then(() => isCurrent() ? work() : undefined);
  automaticWorkerTail = scheduled.then(() => undefined, () => undefined);
  return scheduled;
}
