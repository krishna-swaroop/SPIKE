// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "./icons";
import type { EMergeUpdateController, EMergeUpdateState, UpdateChannel } from "./emergeRuntimeUpdates";
import "./EMergeRuntimeUpdater.css";
type Props = { controller: EMergeUpdateController; state: EMergeUpdateState; python: string; disabled: boolean; running: boolean };
export default function EMergeRuntimeUpdater({ controller, state, python, disabled, running }: Props) {
  const [channel, setChannel] = useState<UpdateChannel>(state.channel);
  useEffect(() => { if (state.status !== "idle" && (state.requested_python !== python.trim() || state.channel !== channel)) controller.invalidate(); }, [controller, python, channel, state.requested_python, state.channel]);
  const blocked = disabled || running || state.status === "checking";
  const selectionMatches = state.requested_python === python.trim() && state.channel === channel;
  return <section className="emerge-runtime-updater" aria-label="Local EMerge updates">
    <header><b>Local EMerge updates</b><span>Update the selected solver environment from PyPI.</span></header>
    <div className="emerge-update-actions"><label>Release channel<select aria-label="EMerge release channel" value={channel} disabled={blocked} onChange={event => setChannel(event.target.value as UpdateChannel)}><option value="prerelease">EMerge 3+ · include prereleases</option><option value="stable">Stable releases · 3+ only</option></select></label>
      <button type="button" disabled={blocked} title="Check the selected Python environment and newer EMerge releases." onClick={() => void controller.check(python, channel)}><RefreshCw size={14}/>{state.status === "checking" ? "Checking…" : "Check for updates"}</button>
      <button type="button" disabled={blocked || !selectionMatches || state.status !== "checked" || !state.can_update} title="Install the checked EMerge version in this local solver environment and check its APIs." onClick={() => void controller.start()}><Download size={14}/>{running ? "Updating…" : state.target_version ? `Update to ${state.target_version}` : "Update EMerge"}</button>
      {running && <button type="button" onClick={() => void controller.refresh()}><RefreshCw size={14}/>Recheck status</button>}
    </div>
    <p className="emerge-update-path">Python: <code>{state.python_executable || python.trim() || "Automatically resolve the configured EMerge virtual environment"}</code></p>
    {state.installed_version && <p>Installed: <b>{state.installed_version}</b>{state.target_version && <> · Selected release: <b>{state.target_version}</b></>}</p>}
    {state.reason && <p>{state.reason}</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {running && <p role="status">{state.status === "starting" ? "Starting local update…" : "Installing EMerge and checking the updated runtime…"} You can close this panel; the workspace keeps tracking this operation.</p>}
    {state.status === "succeeded" && <p role="status">EMerge update completed. The runtime API check passed; simulation results still require validation.</p>}
    {state.status === "failed" && !state.error && <p role="alert">The update or compatibility check failed. Review the log, fix the environment, then check again.</p>}
    {state.status === "failed" && state.install_completed && <p>Installation completed, but the updated environment did not pass all checks. Run a new runtime check before solving.</p>}
    {state.recovery && <p>{state.recovery}</p>}
    {state.compatibility && <details><summary>Runtime compatibility details</summary><pre>{JSON.stringify(state.compatibility, null, 2)}</pre></details>}
    {state.log && <details open={state.status === "failed"}><summary>Update log</summary><pre>{state.log}</pre></details>}
    {disabled && !running && <small>A desktop worker and an idle engine are required to check or update EMerge.</small>}
  </section>;
}
