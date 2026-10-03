// SPDX-License-Identifier: Apache-2.0
import type { WorkerResponse } from "./workerBridge";
export type UpdateChannel = "prerelease" | "stable";
export type EMergeUpdateState = {
  status: "idle" | "checking" | "checked" | "starting" | "running" | "succeeded" | "failed";
  channel: UpdateChannel; requested_python?: string; python_executable?: string; installed_version?: string | null;
  target_version?: string | null; operation_id?: string; can_update?: boolean; reason?: string;
  log?: string; compatibility?: Record<string, unknown>; error?: string;
  install_completed?: boolean; recovery?: string;
};
export type UpdateWorker = (request: Record<string, unknown>) => Promise<WorkerResponse>;
const contract = "spike/emerge-runtime-update/v1";
const active = (state: EMergeUpdateState) => state.status === "starting" || state.status === "running";
function result(response: WorkerResponse): Record<string, unknown> {
  if (!response.ok) throw new Error(response.error ?? "EMerge update request failed.");
  if (response.result?.contract !== contract) throw new Error("The worker returned an unsupported EMerge update response.");
  return response.result;
}

// The workspace owns this controller, so closing its panel does not lose an
// in-flight operation or unlock runtime use while pip is still running.
export class EMergeUpdateController {
  state: EMergeUpdateState = { status: "idle", channel: "prerelease" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private polling = false;
  constructor(private worker: UpdateWorker) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private set(state: EMergeUpdateState) { this.state = state; this.listeners.forEach(listener => listener()); }
  invalidate = () => { if (!active(this.state)) { ++this.generation; this.set({ status: "idle", channel: this.state.channel }); } };
  check = async (python: string, channel: UpdateChannel) => {
    if (active(this.state)) return;
    const token = ++this.generation;
    this.set({ status: "checking", channel, requested_python: python.trim(), python_executable: python.trim() });
    try {
      const data = result(await this.worker({ method: "check_emerge_update", params: { python_executable: python.trim(), channel } }));
      if (token === this.generation) this.set({ ...data, requested_python: python.trim(), status: "checked", channel, error: undefined } as EMergeUpdateState);
    } catch (error) { if (token === this.generation) this.set({ ...this.state, status: "failed", can_update: false, error: String(error instanceof Error ? error.message : error) }); }
  };
  start = async () => {
    const checked = this.state;
    if (checked.status !== "checked" || !checked.can_update || !checked.target_version || !checked.python_executable) return;
    this.set({ ...checked, status: "starting", can_update: false, error: undefined });
    try {
      const data = result(await this.worker({ method: "start_emerge_update", params: { python_executable: checked.python_executable, channel: checked.channel, target_version: checked.target_version } }));
      if (typeof data.operation_id !== "string" || !data.operation_id) throw new Error("The worker returned no update operation identifier.");
      this.set({ ...checked, ...data, status: "running", can_update: false, error: undefined } as EMergeUpdateState);
    } catch (error) { this.set({ ...checked, status: "failed", can_update: false, error: String(error instanceof Error ? error.message : error) }); }
  };
  refresh = async () => {
    const id = this.state.operation_id;
    if (!id || this.state.status !== "running" || this.polling) return;
    this.polling = true;
    try {
      const data = result(await this.worker({ method: "emerge_update_status", params: { operation_id: id } }));
      if (!["running", "succeeded", "failed"].includes(String(data.status))) throw new Error("The worker returned an unknown update state.");
      if (this.state.operation_id === id) this.set({ ...this.state, ...data, can_update: false, error: undefined } as EMergeUpdateState);
    } catch (error) {
      // A missed poll does not establish that an install has stopped.
      if (this.state.operation_id === id) this.set({ ...this.state, error: `Status unavailable: ${String(error instanceof Error ? error.message : error)}. Recheck status to recover.` });
    } finally { this.polling = false; }
  };
}
