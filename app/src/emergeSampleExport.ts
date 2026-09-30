// SPDX-License-Identifier: Apache-2.0
import { emergeAnalysisPayload, reviewEMergeNetwork } from "./emergeNetworkReview";

/** Exports original solved complex samples; no interpolation or inferred ports. */
export function exportEMergeNetwork(value: unknown, format: "csv" | "touchstone"): { name: string; text: string } {
  const review = reviewEMergeNetwork(value);
  if (review.issue || !review.ports.length) throw new Error(review.issue ?? "No solved network samples are available.");
  const payload = emergeAnalysisPayload(value);
  const network = (payload.networks as { s_parameters: { frequencies_hz: number[]; ports: string[]; values: number[][][][]; reference_impedance_ohm?: number } }).s_parameters;
  const count = network.ports.length;
  if (format === "touchstone" && (typeof network.reference_impedance_ohm !== "number" || !Number.isFinite(network.reference_impedance_ohm) || network.reference_impedance_ohm <= 0)) throw new Error("Touchstone export requires a finite positive scalar reference impedance.");
  const lines = format === "csv" ? ["frequency_hz,receive_port,excited_port,real,imaginary"] : ["! SPIKE EMerge original samples; model remains unvalidated", `# Hz S RI R ${network.reference_impedance_ohm}`];
  network.frequencies_hz.forEach((frequency, index) => {
    if (format === "csv") network.ports.forEach((receive, row) => network.ports.forEach((excited, column) => {
      const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;
      lines.push([frequency, quote(receive), quote(excited), ...network.values[index][row][column]].join(","));
    }));
    else {
      // Touchstone 1.x orders two-port terms S11,S21,S12,S22; larger matrices use row order.
      const pairs: number[] = [];
      for (let outer = 0; outer < count; outer++) for (let inner = 0; inner < count; inner++) pairs.push(...network.values[index][count === 2 ? inner : outer][count === 2 ? outer : inner]);
      lines.push([frequency, ...pairs].join(" "));
    }
  });
  return { name: format === "csv" ? "emerge-network.csv" : `emerge-network.s${count}p`, text: lines.join("\n") + "\n" };
}

export function downloadEMergeText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
