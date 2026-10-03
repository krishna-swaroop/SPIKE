// SPDX-License-Identifier: Apache-2.0
/** Display admission for the OpenEMS NF2FF contract; never an EMerge source conversion. */
import type { Vector } from "./emergeNearFieldSamples";
const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e150;
const array = (v: unknown, count: number): v is number[] => Array.isArray(v) && v.length === count && v.every(finite);
export type OpenEMSFarfield = { frequencies: number[]; theta: number[]; phi: number[]; centerMm: number[]; radiusM: number; thetaReal: number[]; thetaImag: number[]; phiReal: number[]; phiImag: number[]; magnitude: number[] };
export function admitOpenEMSFarfield(value: unknown): OpenEMSFarfield | null {
  const raw = rec(value), n = rec(raw.normalization), shape = raw.shape;
  if (raw.contract !== "spike/openems-far-field-result/v1" || raw.status !== "computed" || raw.validation_status !== "not_validated" || rec(raw.validation).status !== "not_validated"
    || n.kind !== "incident_power" || n.incident_power_w !== 1 || n.incident_voltage_phase_deg !== 0 || n.phasor !== "peak" || n.source_spectrum !== "single_sided_pulse_fourier_integral" || n.frequency_sampling !== "exact_port_reevaluation" || !finite(n.reference_impedance_ohm) || n.reference_impedance_ohm <= 0 || n.reference_impedance_ohm > 1e6
    || !Array.isArray(shape) || shape.length !== 3 || !shape.every(v => Number.isInteger(v) && v > 0) || shape[0] > 64 || shape[1] < 2 || shape[1] > 721 || shape[2] < 2 || shape[2] > 1441 || shape[0] * shape[1] * shape[2] > 1000000) return null;
  const [nf, nt, np] = shape, count = nf * nt * np;
  const frequencies = raw.frequencies_hz, theta = raw.theta_deg, phi = raw.phi_deg;
  const increasing = (values: number[]) => values.every((v, i) => i === 0 || v > values[i - 1]);
  if (!array(frequencies, nf) || !increasing(frequencies) || frequencies.some(v => v <= 0 || v > 1e15) || !array(theta, nt) || !increasing(theta) || theta[0] < 0 || theta[nt - 1] > 180 || !array(phi, np) || !increasing(phi) || phi[0] < -360 || phi[np - 1] > 360 || phi[np - 1] - phi[0] > 360
    || !array(raw.center_mm, 3) || raw.center_mm.some(v => Math.abs(v) > 1e9) || !finite(raw.radius_m) || raw.radius_m < 1e-6 || raw.radius_m > 1e6) return null;
  const e = rec(raw.e_field_v_m), et = rec(e.theta), ep = rec(e.phi);
  if (!array(et.real, count) || !array(et.imag, count) || !array(ep.real, count) || !array(ep.imag, count) || !array(e.magnitude, count) || e.magnitude.some(v => v < 0)) return null;
  for (let i = 0; i < count; i++) { const norm = Math.hypot(et.real[i], et.imag[i], ep.real[i], ep.imag[i]); if (Math.abs(norm - e.magnitude[i]) > 1e-9 * Math.max(norm, e.magnitude[i], 1e-300)) return null; }
  return { frequencies, theta, phi, centerMm: raw.center_mm, radiusM: raw.radius_m, thetaReal: et.real, thetaImag: et.imag, phiReal: ep.real, phiImag: ep.imag, magnitude: e.magnitude };
}
export function openEMSFarfieldVectors(field: OpenEMSFarfield, frequencyIndex: number): Vector[] | null {
  if (!Number.isInteger(frequencyIndex) || frequencyIndex < 0 || frequencyIndex >= field.frequencies.length) return null;
  const count = field.theta.length * field.phi.length, offset = frequencyIndex * count;
  return Array.from({ length: count }, (_, index) => {
    const t = field.theta[Math.floor(index / field.phi.length)] * Math.PI / 180, p = field.phi[index % field.phi.length] * Math.PI / 180;
    const theta = [Math.cos(t) * Math.cos(p), Math.cos(t) * Math.sin(p), -Math.sin(t)], phi = [-Math.sin(p), Math.cos(p), 0], sample = offset + index;
    return theta.map((coefficient, axis) => [coefficient * field.thetaReal[sample] + phi[axis] * field.phiReal[sample], coefficient * field.thetaImag[sample] + phi[axis] * field.phiImag[sample]]);
  });
}
export function openEMSFarfieldCut(field: OpenEMSFarfield, frequencyIndex: number): { phiDeg: number; thetaDeg: number[]; magnitudeVm: number[] } | null {
  if (!Number.isInteger(frequencyIndex) || frequencyIndex < 0 || frequencyIndex >= field.frequencies.length) return null;
  const phiIndex = field.phi.reduce((best, value, index) => Math.abs(value) < Math.abs(field.phi[best]) ? index : best, 0);
  const offset = frequencyIndex * field.theta.length * field.phi.length;
  return { phiDeg: field.phi[phiIndex], thetaDeg: field.theta, magnitudeVm: field.theta.map((_, index) => field.magnitude[offset + index * field.phi.length + phiIndex]) };
}
