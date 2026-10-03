// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, useSyncExternalStore } from "react";
import { EMergeUpdateController, type UpdateWorker } from "./emergeRuntimeUpdates";
export function useEMergeRuntimeUpdates(worker: UpdateWorker) {
  const [controller] = useState(() => new EMergeUpdateController(worker));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    if (state.status !== "running") return;
    const timer = setTimeout(() => void controller.refresh(), state.error ? 5000 : 1500);
    return () => clearTimeout(timer);
  }, [controller, state]);
  return { controller, state, running: state.status === "running" || state.status === "starting" };
}
