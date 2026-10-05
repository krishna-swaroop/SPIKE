// SPDX-License-Identifier: Apache-2.0
/** A graph plan is scheduling evidence, separate from numerical study results. */
export function assemblyPlanPresentation(plan: Record<string, unknown>) {
  const independent = plan.mode === "independent_board_batch";
  const admitted = plan.state === "admitted";
  const issues = Array.isArray(plan.issues) ? plan.issues as Array<Record<string, unknown>> : [];
  return {
    title: admitted ? "Independent board plan is ready. No analysis has run."
      : independent ? "Independent board plan needs review."
        : "This graph-only plan cannot execute a coupled study.",
    explanation: independent
      ? "Each board is analyzed separately. Connector, harness and cross-board effects are excluded from this plan."
      : "Use the coupled study editor above to run supplied circuit, thermal or magnetic-loop models. General assembly field coupling remains unqualified.",
    savedResultsNote: "This planning check does not load, run or invalidate the results saved in your project.",
    errors: issues.filter(issue => issue.severity === "error" && typeof issue.message === "string").map(issue => String(issue.message)),
  };
}
