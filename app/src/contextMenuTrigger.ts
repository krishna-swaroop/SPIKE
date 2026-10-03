// SPDX-License-Identifier: Apache-2.0
import type { KeyboardEvent, MouseEvent } from "react";
export function contextMenuTrigger(open: (x: number, y: number) => void) {
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); open(event.clientX, event.clientY); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault(); event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); open(box.left, box.bottom);
    },
  };
}
