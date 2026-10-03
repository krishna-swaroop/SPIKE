// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { AssemblyIr } from "./mcadAssembly";
import type { ParsedBoard } from "./boardParser";
import { normalizeAssemblyResultOverlays, type AssemblyBoardResultOverlay } from "./assemblyResultOverlays";
import { runLocalWorker } from "./workerBridge";

/** Saved results become overlays only after worker validation against physical placement. */
export function useAssemblySavedResultOverlays(assembly: AssemblyIr | null, whenVisualsReady: () => Promise<ParsedBoard | null>) {
  const [state, setState] = useState<{ overlays: AssemblyBoardResultOverlay[]; diagnostics: string[] }>({ overlays: [], diagnostics: [] });
  useEffect(() => {
    let cancelled = false;
    setState({ overlays: [], diagnostics: [] });
    const studies = (assembly?.extensions as Record<string, any> | undefined)?.["spike.multiboard-studies"];
    if (!assembly || !studies) return;
    void (async () => {
      await whenVisualsReady();
      const results: unknown[] = [], diagnostics: string[] = [];
      for (const domain of ["pi", "si", "thermal", "emi"]) {
        if (cancelled) return;
        const study = studies[domain]; if (!study?.result) continue;
        let checked = await runLocalWorker({ method: "validate_multiboard_study_result", params: { assembly, domain, request: study.request, result: study.result } });
        const deadline = Date.now() + 180_000;
        while (!cancelled && !checked.ok && (checked.type === "WorkerBusyError" || /WORKER_BUSY/.test(checked.error ?? "")) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!cancelled) checked = await runLocalWorker({ method: "validate_multiboard_study_result", params: { assembly, domain, request: study.request, result: study.result } });
        }
        if (checked.ok) results.push(study.result);
        else diagnostics.push(`${domain.toUpperCase()} overlay inactive: ${checked.error_detail?.detail ?? checked.error ?? "saved result validation failed"}`);
      }
      if (!cancelled) setState({ overlays: normalizeAssemblyResultOverlays(results), diagnostics });
    })().catch(error => { if (!cancelled) setState({ overlays: [], diagnostics: [String(error)] }); });
    return () => { cancelled = true; };
  }, [assembly, whenVisualsReady]);
  return state;
}
