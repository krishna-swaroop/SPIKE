// SPDX-License-Identifier: Apache-2.0
import { awaitNativeWindowCreated } from "./detachedToolWindows";
import { assemblyToolLabels, isAssemblyToolKind, validAssemblyToolAction, type AssemblyToolAction, type AssemblyToolKind, type AssemblyToolSnapshot } from "./assemblyToolWindowModel";

const SNAPSHOT = "spike-assembly-tool-snapshot", ACTION = "spike-assembly-tool-action", RESPONSE = "spike-assembly-tool-response";
type Envelope = { token: string; kind: AssemblyToolKind; revision?: string; requestId?: string; action?: AssemblyToolAction; snapshot?: AssemblyToolSnapshot; result?: unknown; error?: string };
type Session = { token: string; snapshot: AssemblyToolSnapshot; handle: (action: AssemblyToolAction) => unknown | Promise<unknown>; stop: () => void; child?: Window; channel?: BroadcastChannel };
const sessions = new Map<AssemblyToolKind, Session>();
const native = () => "__TAURI_INTERNALS__" in window;
/** Reuse the tool and its current draft when an entry point is clicked again. */
export async function focusAssemblyToolWindow(kind: AssemblyToolKind): Promise<boolean> {
  const session = sessions.get(kind); if (!session) return false;
  if (native()) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const child = await WebviewWindow.getByLabel(assemblyToolLabels[kind]);
    if (!child) return false;
    await child.unminimize(); await child.show(); await child.setFocus();
  } else {
    if (!session.child || session.child.closed) return false;
    session.child.focus();
  }
  return true;
}
export async function onAssemblyToolCloseRequest(handler: (prevent: () => void) => void): Promise<() => void> {
  if (!native()) return () => {};
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().onCloseRequested(event => handler(() => event.preventDefault()));
}
export function assemblyToolKindFromLocation(search = window.location.search): AssemblyToolKind | null {
  const value = new URLSearchParams(search).get("spikeAssemblyTool");
  return isAssemblyToolKind(value) ? value : null;
}
function urlFor(kind: AssemblyToolKind, token: string): string {
  const url = new URL(window.location.href); url.search = ""; url.hash = "";
  url.searchParams.set("spikeAssemblyTool", kind); url.searchParams.set("assemblyToken", token);
  return `${url.pathname}${url.search}`;
}
async function send(kind: AssemblyToolKind, event: string, envelope: Envelope) {
  if (native()) { const { emitTo } = await import("@tauri-apps/api/event"); await emitTo(assemblyToolLabels[kind], event, envelope); }
  else sessions.get(kind)?.channel?.postMessage({ event, envelope });
}
export async function updateAssemblyToolWindow(kind: AssemblyToolKind, snapshot: AssemblyToolSnapshot) {
  const session = sessions.get(kind); if (!session) return;
  session.snapshot = snapshot;
  await send(kind, SNAPSHOT, { kind, token: session.token, snapshot });
}
async function receive(envelope: Envelope) {
  if (!isAssemblyToolKind(envelope?.kind)) return;
  const session = sessions.get(envelope.kind);
  if (!session || envelope.token !== session.token || !validAssemblyToolAction(envelope.action)) return;
  const action = envelope.action;
  if (action.type === "ready") { await updateAssemblyToolWindow(envelope.kind, session.snapshot); return; }
  try {
    // A stale child cannot replace a newer physical assembly or layer state.
    if (!["closed", "close", "draft-dirty", "status", "save", "reload", "view", "manager", "collaboration"].includes(action.type) && envelope.revision !== session.snapshot.revision) throw new Error("Assembly changed in the workspace. Review the refreshed tool and retry.");
    const result = await session.handle(action);
    if (envelope.requestId) await send(envelope.kind, RESPONSE, { kind: envelope.kind, token: session.token, requestId: envelope.requestId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (envelope.requestId) await send(envelope.kind, RESPONSE, { kind: envelope.kind, token: session.token, requestId: envelope.requestId, error: message });
    else await session.handle({ type: "status", value: message });
  }
}
export async function openAssemblyToolWindow(kind: AssemblyToolKind, snapshot: AssemblyToolSnapshot, handle: Session["handle"]) {
  const existing = sessions.get(kind);
  if (existing) {
    existing.handle = handle;
    if (await focusAssemblyToolWindow(kind)) { await updateAssemblyToolWindow(kind, snapshot); return; }
    sessions.delete(kind); existing.stop(); existing.channel?.close();
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
  const session: Session = { token, snapshot, handle, stop: () => {} }; sessions.set(kind, session);
  try {
    if (native()) {
      const { listen } = await import("@tauri-apps/api/event");
      session.stop = await listen<Envelope>(ACTION, event => { if (event.payload?.kind === kind) void receive(event.payload); });
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const stale = await WebviewWindow.getByLabel(assemblyToolLabels[kind]); await stale?.destroy();
      const title = kind === "workspace" ? "Multi-board workspace" : kind === "placement" ? "Board placement" : "Board layers, nets & links";
      const child = new WebviewWindow(assemblyToolLabels[kind], { url: urlFor(kind, token), title: `SPIKE | ${title}`, width: kind === "workspace" ? 1120 : 860, height: kind === "placement" ? 530 : 760, minWidth: 520, minHeight: 360, resizable: true, decorations: true, backgroundColor: "#101820", dragDropEnabled: false });
      await child.once("tauri://destroyed", () => {
        if (sessions.get(kind) === session) { sessions.delete(kind); session.stop(); void session.handle({ type: "closed" }); }
      });
      await awaitNativeWindowCreated(child);
    } else {
      session.channel = new BroadcastChannel(`spike-assembly-tool:${token}`);
      session.channel.addEventListener("message", event => { if (event.data?.event === ACTION) void receive(event.data.envelope); });
      session.child = window.open(urlFor(kind, token), `${assemblyToolLabels[kind]}-${token}`, "popup=yes,width=1000,height=700,resizable=yes,scrollbars=yes") ?? undefined;
      if (!session.child) throw new Error("Allow local SPIKE popup windows, then retry.");
    }
    await updateAssemblyToolWindow(kind, snapshot);
  } catch (error) { sessions.delete(kind); session.stop(); session.channel?.close(); throw error; }
}
export async function closeAssemblyToolWindow(kind: AssemblyToolKind) {
  const session = sessions.get(kind); if (!session) return;
  // Only called after the child's own dirty-draft close handling, or parent shutdown.
  sessions.delete(kind); session.stop(); session.channel?.close();
  if (native()) { const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow"); await (await WebviewWindow.getByLabel(assemblyToolLabels[kind]))?.destroy(); }
  else session.child?.close();
}
export async function connectAssemblyToolChild(kind: AssemblyToolKind, onSnapshot: (snapshot: AssemblyToolSnapshot) => void) {
  const token = new URLSearchParams(window.location.search).get("assemblyToken");
  if (!token || !/^[a-f0-9]{48}$/.test(token)) throw new Error("Invalid assembly tool session. Reopen it from SPIKE.");
  let revision = "", stopped = false;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let channel: BroadcastChannel | undefined; const stops: Array<() => void> = [];
  const received = (event: string, envelope: Envelope) => {
    if (stopped || envelope?.token !== token || envelope.kind !== kind) return;
    if (event === SNAPSHOT && envelope.snapshot) { revision = envelope.snapshot.revision; onSnapshot(envelope.snapshot); }
    if (event === RESPONSE && envelope.requestId) { const request = pending.get(envelope.requestId); if (!request) return; clearTimeout(request.timer); pending.delete(envelope.requestId); envelope.error ? request.reject(new Error(envelope.error)) : request.resolve(envelope.result); }
  };
  if (native()) {
    const { listen } = await import("@tauri-apps/api/event");
    for (const event of [SNAPSHOT, RESPONSE]) stops.push(await listen<Envelope>(event, message => received(event, message.payload), { target: { kind: "WebviewWindow", label: assemblyToolLabels[kind] } }));
  } else { channel = new BroadcastChannel(`spike-assembly-tool:${token}`); channel.addEventListener("message", event => received(event.data?.event, event.data?.envelope)); }
  const act = async (action: AssemblyToolAction): Promise<unknown> => {
    if (stopped) throw new Error("Assembly tool disconnected. Reopen it from SPIKE.");
    if (["ready", "close", "closed"].includes(action.type)) {
      const envelope: Envelope = { kind, token, revision, action };
      if (native()) { const { emitTo } = await import("@tauri-apps/api/event"); await emitTo("main", ACTION, envelope); }
      else channel?.postMessage({ event: ACTION, envelope });
      return undefined;
    }
    const requestId = crypto.randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Workspace did not respond. Return to SPIKE and retry.")); }, 120000);
      pending.set(requestId, { resolve, reject, timer });
    });
    const envelope: Envelope = { kind, token, revision, requestId, action };
    try { if (native()) { const { emitTo } = await import("@tauri-apps/api/event"); await emitTo("main", ACTION, envelope); } else channel?.postMessage({ event: ACTION, envelope }); }
    catch (error) { const request = pending.get(requestId); if (request) { clearTimeout(request.timer); pending.delete(requestId); request.reject(error instanceof Error ? error : new Error(String(error))); } }
    return promise;
  };
  void act({ type: "ready" }).catch(() => {});
  return { act, stop: () => { stopped = true; stops.forEach(stop => stop()); channel?.close(); pending.forEach(request => { clearTimeout(request.timer); request.reject(new Error("Assembly tool closed.")); }); pending.clear(); } };
}
