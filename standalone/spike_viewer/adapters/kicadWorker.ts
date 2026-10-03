// SPDX-License-Identifier: Apache-2.0
import { parseKicadBoard } from "./kicadBoardParser";

type Request = { source: string };
type Reply = { ok: true; board: ReturnType<typeof parseKicadBoard> } | { ok: false; error: string };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Reply): void;
};

scope.onmessage = event => {
  try {
    scope.postMessage({ ok: true, board: parseKicadBoard(event.data.source) });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
