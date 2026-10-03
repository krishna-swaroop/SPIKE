// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard } from "../src/engine/boardTypes";
import { parseKicadBoard } from "./kicadBoardParser";

const KICAD_TIMEOUT_MS = 10_000;
type WorkerReply = { ok: true; board: ParsedBoard } | { ok: false; error: string };

function abortError(): DOMException {
  return new DOMException("The import was cancelled.", "AbortError");
}

function parseInWorker(source: string, signal?: AbortSignal): Promise<ParsedBoard> {
  if (signal?.aborted) return Promise.reject(abortError());
  const worker = new Worker(new URL("./kicadWorker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(() => finish(() => reject(new Error(`KiCad parsing exceeded ${KICAD_TIMEOUT_MS / 1000} seconds.`))), KICAD_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onerror = event => finish(() => reject(new Error(event.message || "The KiCad parser worker failed.")));
    worker.onmessage = (event: MessageEvent<WorkerReply>) => finish(() => {
      if (event.data?.ok) resolve(event.data.board);
      else reject(new Error(event.data?.error || "The KiCad parser worker failed."));
    });
    worker.postMessage({ source });
  });
}

export async function parseKicad(source: string, signal?: AbortSignal): Promise<ParsedBoard> {
  if (signal?.aborted) throw abortError();
  if (typeof Worker !== "undefined" && typeof document !== "undefined") return parseInWorker(source, signal);
  const board = parseKicadBoard(source);
  if (signal?.aborted) throw abortError();
  return board;
}
