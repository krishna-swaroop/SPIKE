// SPDX-License-Identifier: Apache-2.0
/** Inputs and nested editor surfaces own keyboard events, including clipboard and undo. */
export function ownsKeyboardInput(target: EventTarget | null): boolean {
  const element = target as (Element & { isContentEditable?: boolean }) | null;
  return Boolean(element?.isContentEditable || element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .monaco-editor, .cm-editor'));
}
