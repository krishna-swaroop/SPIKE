import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/webviewGuards.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const guards = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

const key = (value, patch = {}) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...patch });
assert.equal(guards.shouldBlockBrowserShortcut(key("F5")), true);
assert.equal(guards.shouldBlockBrowserShortcut(key("r", { ctrlKey: true })), true);
assert.equal(guards.shouldBlockBrowserShortcut(key("ArrowLeft", { altKey: true })), true);
assert.equal(guards.shouldBlockBrowserShortcut(key("p", { metaKey: true })), true);
assert.equal(guards.shouldBlockBrowserShortcut(key("c", { ctrlKey: true })), false, "native copy remains available");
assert.equal(guards.shouldBlockBrowserShortcut(key("v", { metaKey: true })), false, "native paste remains available");
assert.equal(guards.shouldBlockBrowserShortcut(key("z", { ctrlKey: true })), false, "native undo remains available");
assert.equal(guards.shouldBlockBrowserShortcut(key("F12")), true);
assert.equal(guards.shouldBlockBrowserShortcut(key("F12"), true), false, "development tools remain available when explicitly enabled");
assert.equal(guards.shouldBlockBrowserShortcut(key("i", { ctrlKey: true, shiftKey: true }), true), false);

const target = new EventTarget();
let downstreamContextMenu = false;
const remove = guards.installWebviewGuards(target);
target.addEventListener("contextmenu", () => { downstreamContextMenu = true; });
const contextMenu = new Event("contextmenu", { cancelable: true });
target.dispatchEvent(contextMenu);
assert.equal(contextMenu.defaultPrevented, true, "the WebView context menu default is suppressed");
assert.equal(downstreamContextMenu, true, "application context-menu listeners still run");
remove();
const afterRemove = new Event("contextmenu", { cancelable: true });
target.dispatchEvent(afterRemove);
assert.equal(afterRemove.defaultPrevented, false, "the guard can be removed cleanly");

const bootstrap = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(bootstrap, /installWebviewGuards\(window,/);
assert.match(app, /document\.addEventListener\("keydown", onKey\)/, "application shortcuts run at document bubbling before the window guard");
assert.doesNotMatch(app, /window\.addEventListener\("keydown", onKey\)/);
if (app.includes("onNavigationKey")) assert.match(app, /document\.addEventListener\("keydown", onNavigationKey\)/, "custom shortcuts run before the window guard");

const guardedWindow = new EventTarget();
const appDocument = new EventTarget();
guards.installWebviewGuards(guardedWindow);
let fixedActionRuns = 0;
appDocument.addEventListener("keydown", event => {
  if (event.defaultPrevented) return;
  fixedActionRuns += 1;
  event.preventDefault();
});
const save = new Event("keydown", { cancelable: true });
Object.defineProperties(save, { key: { value: "s" }, ctrlKey: { value: true }, metaKey: { value: false }, altKey: { value: false }, shiftKey: { value: false } });
appDocument.dispatchEvent(save);
guardedWindow.dispatchEvent(save);
assert.equal(fixedActionRuns, 1, "the document-level app action runs before final browser-default suppression");
assert.equal(save.defaultPrevented, true);

console.log("webview guard assertions passed");
