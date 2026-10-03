// SPDX-License-Identifier: Apache-2.0
export type OpenEMSDomain = "pi" | "si" | "em" | "mesh";
export type OpenEMSPort = { start: [string, string, string]; stop: [string, string, string]; direction: "x" | "y" | "z"; impedance_ohm: string; excite: boolean };
export const openEMSFields = {
  frequency_start_hz: ["Sweep start (Hz)", "", 0, 1e15], frequency_stop_hz: ["Sweep stop (Hz)", "", 0, 1e15], frequency_points: ["Sweep points", "21", 2, 100000, true],
  mesh_resolution_mm: ["Mesh resolution (mm)", "0.5", .0001, 100], dielectric_cells_per_layer: ["Cells per dielectric layer", "3", 1, 64, true],
  air_padding_mm: ["Air padding (mm)", "10", 0, 1000], mesh_growth_ratio: ["Mesh growth ratio", "1.4", 1, 2],
  max_solver_time_s: ["Maximum solver time (s)", "300", 1, 3300], max_timesteps: ["Maximum FDTD timesteps", "1000000", 1000, 2000000000, true],
  threads: ["Threads (0 = automatic)", "0", 0, 1024, true], max_estimated_cells: ["Maximum estimated cells", "25000000", 1, 200000000, true],
  memory_limit_gib: ["Estimated memory limit (GiB)", "8", .0625, 64], end_criteria: ["FDTD end criterion", "0.00001", 1e-12, 1],
  reference_impedance_ohm: ["Network reference impedance (ohm)", "50", 0, 1e9], via_plating_thickness_mm: ["Via plating thickness (mm)", "0.025", 0, 5],
} as const;
export type OpenEMSNumericKey = keyof typeof openEMSFields;
export type OpenEMSSetup = Record<OpenEMSNumericKey, string> & { net_names: string[]; ports: OpenEMSPort[]; boundary_conditions: string[]; far_field_enabled: boolean;
  far_field_frequencies_hz: string; center_mm: [string, string, string]; radius_m: string; theta_start_deg: string; theta_stop_deg: string; theta_points: string;
  phi_start_deg: string; phi_stop_deg: string; phi_points: string; max_far_field_samples: string };
export const newOpenEMSPort = (): OpenEMSPort => ({ start: ["", "", ""], stop: ["", "", ""], direction: "z", impedance_ohm: "50", excite: false });
export const defaultOpenEMSSetup = (): OpenEMSSetup => ({ ...Object.fromEntries(Object.entries(openEMSFields).map(([key, field]) => [key, field[1]])) as Record<OpenEMSNumericKey, string>,
  net_names: [], ports: [], boundary_conditions: Array(6).fill("PML_8"), far_field_enabled: false, far_field_frequencies_hz: "", center_mm: ["", "", ""], radius_m: "1",
  theta_start_deg: "0", theta_stop_deg: "180", theta_points: "37", phi_start_deg: "0", phi_stop_deg: "360", phi_points: "73", max_far_field_samples: "250000" });
function number(value: string, label: string, min: number, max: number, integer = false): number {
  if (!value.trim()) throw new Error(`${label} is required.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || integer && !Number.isInteger(parsed)) throw new Error(`${label} must be ${integer ? "a whole number" : "finite"} between ${min} and ${max}.`);
  return parsed;
}
export function openEMSParameters(setup: OpenEMSSetup, domain: OpenEMSDomain, operation: "preflight" | "prepare" | "run"): Record<string, unknown> {
  if (!["pi", "si", "em", "mesh"].includes(domain) || !["preflight", "prepare", "run"].includes(operation)) throw new Error("Choose a supported OpenEMS domain and operation.");
  if (!setup.net_names.length || setup.net_names.some(net => typeof net !== "string" || !net.trim()) || new Set(setup.net_names).size !== setup.net_names.length) throw new Error("Select one or more distinct complete board nets, including port return conductors.");
  const values = Object.fromEntries(Object.entries(openEMSFields).map(([key, field]) => [key, number(setup[key as OpenEMSNumericKey], field[0], field[2], field[3], field.length === 5)]));
  if (values.frequency_start_hz <= 0 || values.frequency_stop_hz <= values.frequency_start_hz) throw new Error("Sweep frequencies must be positive and increasing.");
  if (values.mesh_growth_ratio <= 1 || values.reference_impedance_ohm <= 0 || values.via_plating_thickness_mm <= 0) throw new Error("Mesh growth must exceed 1; impedance and via plating thickness must be positive.");
  if (setup.boundary_conditions.length !== 6 || setup.boundary_conditions.some(value => !/^(PEC|PMC|MUR|PML_[1-9][0-9]?)$/.test(value))) throw new Error("Set all six boundary conditions to PEC, PMC, MUR or PML_1..PML_99.");
  if (setup.ports.length > 8 || operation === "run" && !setup.ports.length) throw new Error("A solver run needs 1–8 explicitly located ports; geometry preparation may omit ports.");
  const ports = setup.ports.map((port, index) => {
    if (port.start.length !== 3 || port.stop.length !== 3 || !["x", "y", "z"].includes(port.direction) || typeof port.excite !== "boolean") throw new Error(`Port ${index + 1} has an invalid direction, excitation or coordinates.`);
    const point = (values: string[], end: string) => values.map((value, axis) => number(value, `Port ${index + 1} ${end} ${"XYZ"[axis]} (mm)`, -1e9, 1e9));
    const start = point(port.start, "start"), stop = point(port.stop, "stop");
    if (start.every((value, axis) => value === stop[axis])) throw new Error(`Port ${index + 1} endpoints must be distinct.`);
    const impedance = number(port.impedance_ohm, `Port ${index + 1} impedance (ohm)`, 0, 1e9);
    if (!impedance) throw new Error(`Port ${index + 1} impedance must be positive.`);
    return { start, stop, direction: port.direction, impedance_ohm: impedance, excite: port.excite };
  });
  if (ports.length && ports.filter(port => port.excite).length !== 1) throw new Error("Exactly one explicit port must be excited.");
  const engine_options: Record<string, unknown> = { ...values, boundary_conditions: [...setup.boundary_conditions], max_estimated_memory_bytes: Math.round(values.memory_limit_gib * 1024 ** 3) };
  for (const key of ["frequency_start_hz", "frequency_stop_hz", "frequency_points", "memory_limit_gib"]) delete engine_options[key];
  const options: Record<string, unknown> = { ports };
  if (setup.far_field_enabled) {
    if (!ports.length) throw new Error("NF2FF requires explicit excitation ports.");
    if (setup.boundary_conditions.some(value => ["PEC", "PMC"].includes(value))) throw new Error("NF2FF needs radiating MUR or PML boundaries on every face.");
    if (values.air_padding_mm < 4 * values.mesh_resolution_mm) throw new Error("NF2FF requires at least four mesh cells of air padding.");
    const frequencyTokens = setup.far_field_frequencies_hz.split(/[ ,;\n]+/).filter(Boolean);
    const frequencies = frequencyTokens.map(value => number(value, "NF2FF frequency (Hz)", values.frequency_start_hz, values.frequency_stop_hz));
    if (!frequencies.length || frequencies.length > 64 || frequencies.some((value, index) => index > 0 && value <= frequencies[index - 1])) throw new Error("NF2FF requires 1–64 strictly increasing frequencies inside the sweep.");
    const theta = { start_deg: number(setup.theta_start_deg, "Theta start (deg)", 0, 180), stop_deg: number(setup.theta_stop_deg, "Theta stop (deg)", 0, 180), points: number(setup.theta_points, "Theta points", 2, 721, true) };
    const phi = { start_deg: number(setup.phi_start_deg, "Phi start (deg)", -360, 360), stop_deg: number(setup.phi_stop_deg, "Phi stop (deg)", -360, 360), points: number(setup.phi_points, "Phi points", 2, 1441, true) };
    if (theta.stop_deg <= theta.start_deg || phi.stop_deg <= phi.start_deg || phi.stop_deg - phi.start_deg > 360) throw new Error("Angular sampling must increase; phi may span at most 360 degrees.");
    const budget = number(setup.max_far_field_samples, "NF2FF sample budget", 1, 1000000, true);
    if (frequencies.length * theta.points * phi.points > budget) throw new Error("NF2FF angular and frequency samples exceed the declared sample budget.");
    options.far_field = { contract: "spike/openems-far-field-request/v1", frequencies_hz: frequencies, theta, phi, radius_m: number(setup.radius_m, "Observation radius (m)", 1e-6, 1e6), center_mm: setup.center_mm.map((value, axis) => number(value, `Phase center ${"XYZ"[axis]} (mm)`, -1e9, 1e9)) };
    engine_options.max_far_field_samples = budget;
  }
  return { operation, analysis: { contract: "spike/v1", mode: domain === "mesh" ? "em" : domain, solver_id: "external.openems", net_names: [...setup.net_names],
    frequency_start_hz: values.frequency_start_hz, frequency_stop_hz: values.frequency_stop_hz, frequency_points: values.frequency_points,
    sources: [], loads: [], return_path: {}, probes: [], mesh: {}, limits: {}, options }, engine_options };
}
