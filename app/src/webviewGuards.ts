// SPDX-License-Identifier: Apache-2.0

export type BrowserShortcutEvent = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">;

const primaryBrowserKeys = new Set(["f", "h", "j", "l", "n", "o", "p", "r", "s", "u", "w", "+", "-", "=", "0"]);
const developerKeys = new Set(["c", "i", "j"]);

export function shouldBlockBrowserShortcut(event: BrowserShortcutEvent, allowDeveloperTools = false): boolean {
  const key = event.key.toLowerCase();
  const primary = event.ctrlKey || event.metaKey;

  if (key === "browserback" || key === "browserforward") return true;
  if (event.altKey && !primary && (key === "arrowleft" || key === "arrowright")) return true;
  if (key === "f5") return true;
  if (key === "f12") return !allowDeveloperTools;
  if (!primary || event.altKey) return false;
  if (event.shiftKey && developerKeys.has(key)) return !allowDeveloperTools;
  return primaryBrowserKeys.has(key);
}

export function installWebviewGuards(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  options: { allowDeveloperTools?: boolean } = {},
): () => void {
  const onContextMenu = (event: Event) => event.preventDefault();
  const onKeyDown = (event: KeyboardEvent) => {
    if (shouldBlockBrowserShortcut(event, options.allowDeveloperTools ?? false)) event.preventDefault();
  };

  // Bubble-phase listeners let application handlers run and only cancel the
  // WebView/browser default. Custom viewport context menus keep receiving the event.
  target.addEventListener("contextmenu", onContextMenu);
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
    target.removeEventListener("keydown", onKeyDown);
  };
}
