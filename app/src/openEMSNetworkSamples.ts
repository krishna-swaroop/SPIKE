// SPDX-License-Identifier: Apache-2.0
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type OpenEMSNetworkSamples = { frequencies: number[]; ports: string[]; values: ([number, number] | null)[][][]; missingColumns: string[]; referenceImpedance: number };
export function admitOpenEMSNetworkSamples(value: unknown): OpenEMSNetworkSamples | null {
  const raw = object(value), frequencies = raw.frequencies_hz, ports = raw.ports, values = raw.values, mask = raw.valid_mask, missing = raw.missing_columns;
  if (raw.column_scope !== "single actual excited port; other columns are null and invalid" || !Array.isArray(frequencies) || !frequencies.length || frequencies.length > 100000 || frequencies.some((f, i) => typeof f !== "number" || !Number.isFinite(f) || f <= 0 || i > 0 && f <= frequencies[i - 1])
    || !Array.isArray(ports) || !ports.length || ports.length > 8 || ports.some((port, i) => port !== `P${i + 1}`) || !Array.isArray(missing) || new Set(missing).size !== missing.length || missing.some(port => !ports.includes(port)) || missing.length !== ports.length - 1
    || !Array.isArray(values) || !Array.isArray(mask) || values.length !== frequencies.length || mask.length !== frequencies.length || frequencies.length * ports.length ** 2 > 1000000
    || typeof raw.reference_impedance_ohm !== "number" || !Number.isFinite(raw.reference_impedance_ohm) || raw.reference_impedance_ohm <= 0) return null;
  for (let frequency = 0; frequency < frequencies.length; frequency++) {
    if (!Array.isArray(values[frequency]) || values[frequency].length !== ports.length || !Array.isArray(mask[frequency]) || mask[frequency].length !== ports.length) return null;
    for (let receive = 0; receive < ports.length; receive++) {
      if (!Array.isArray(values[frequency][receive]) || values[frequency][receive].length !== ports.length || !Array.isArray(mask[frequency][receive]) || mask[frequency][receive].length !== ports.length) return null;
      for (let excited = 0; excited < ports.length; excited++) {
        const pair = values[frequency][receive][excited], valid = mask[frequency][receive][excited];
        if (typeof valid !== "boolean" || valid !== !missing.includes(ports[excited])) return null;
        if (valid ? !Array.isArray(pair) || pair.length !== 2 || !pair.every(value => typeof value === "number" && Number.isFinite(value)) : pair !== null) return null;
      }
    }
  }
  return { frequencies, ports, values, missingColumns: missing, referenceImpedance: raw.reference_impedance_ohm };
}
export function exportOpenEMSNetworkTouchstone(network: OpenEMSNetworkSamples): { name: string; text: string } {
  if (network.missingColumns.length || network.values.some(matrix => matrix.some(row => row.some(pair => pair === null)))) throw new Error("Touchstone requires every excitation column to be actually computed.");
  const count = network.ports.length;
  const lines = ["! SPIKE OpenEMS actual samples; numerical result remains unvalidated", `# Hz S RI R ${network.referenceImpedance}`];
  network.frequencies.forEach((frequency, i) => {
    const pairs: number[] = [];
    for (let outer = 0; outer < count; outer++) for (let inner = 0; inner < count; inner++) pairs.push(...network.values[i][count === 2 ? inner : outer][count === 2 ? outer : inner]!);
    lines.push([frequency, ...pairs].join(" "));
  });
  return { name: `openems-network.s${count}p`, text: lines.join("\n") + "\n" };
}
