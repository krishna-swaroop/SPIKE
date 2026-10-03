// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { studyDraft, studyResultRows } from '../src/multiboardStudyPresentation.ts';

const model = { contract: 'spike/multiboard-circuit-request/v1', domain: 'si', ground: { board_id: 'a', node: 'J:2' },
  analysis: { mode: 'ac' }, board_models: [{ board_id: 'a', elements: [] }, { board_id: 'b', elements: [] }],
  link_models: [{ link_id: 'cable', kind: 'harness', pins: [{ source_pin: '1', target_pin: '5' }] }], assembly: { name: 'must be stripped' } };
const draft = studyDraft(model, 'si');
assert.equal(draft.assembly, undefined);
assert.ok(model.assembly, 'shape admission must not alter original file');
for (const malformed of [null, [], {}, { ...model, domain: 'pi' }, { ...model, ground: null },
  { ...model, link_models: [{ link_id: 'cable', kind: 'harness', pins: null }] },
  { ...model, board_models: [{ board_id: 'a', elements: [{ type: null }] }] }]) {
  assert.throws(() => studyDraft(malformed, 'si'));
}
const result = { ground_node: 'a-return', node_map: { a: { 'J:1': 'a-feed', 'J:2': 'a-return' }, b: { 'J:1': 'b-feed' } },
  native_result: { data: { node_voltage_v: { 'a-feed': { magnitude: [1, .8] }, 'b-feed': { magnitude: [.5, .3] } } } } };
const rows = studyResultRows(result, 'si', 1);
assert.deepEqual(rows.map(row => [row.board, row.node, row.value]), [['a', 'J:1', .8], ['a', 'J:2', 0], ['b', 'J:1', .3]]);
assert.deepEqual(studyResultRows({ board_temperatures_c: { a: { board: 30 }, b: { board: 27 } } }, 'thermal').map(row => row.value), [30, 27]);
assert.deepEqual(studyResultRows({ samples: [{ loops: [{ board_id: 'b', loop_id: 'victim', current_magnitude_a: .02 }] }] }, 'emi'),
  [{ board: 'b', node: 'victim', value: .02, unit: 'A RMS' }]);
console.log('Coupled study malformed-input guards and occurrence result presentation passed.');

const chassis = { ...model, part_models: [{ part_id: 'case', elements: [{ type: 'capacitor' }] }],
  ground: { part_id: 'case', node: 'return' }, electrical_bond_models: [{ bond_id: 'bond',
    endpoint_a: { board_id: 'a', node: 'J:2' }, endpoint_b: { part_id: 'case', node: 'return' } }] };
assert.equal(studyDraft(chassis, 'si').part_models[0].part_id, 'case');
assert.throws(() => studyDraft({ ...chassis, ground: { board_id: 'a', part_id: 'case' } }, 'si'));
assert.throws(() => studyDraft({ ...chassis, electrical_bond_models: [{ ...chassis.electrical_bond_models[0], endpoint_a: {} }] }, 'si'));
const partRows = studyResultRows({ ...result, part_node_map: { case: { return: 'a-return', plate: 'a-feed' } } }, 'si', 1);
assert.deepEqual(partRows.slice(-2).map(row => [row.owner_kind, row.board, row.node, row.value]), [['part', 'case', 'return', 0], ['part', 'case', 'plate', .8]]);
assert.deepEqual(studyResultRows({ part_temperatures_c: { case: { body: 28 } } }, 'thermal').map(row => [row.owner_kind, row.board, row.value]), [['part', 'case', 28]]);
const magnetic = { contract: 'spike/multiboard-em-request/v1', loops: [{ loop_id: 'shield', part_id: 'case' }], mutual_inductances: [], connector_models: [], frequency_hz: [] };
assert.equal(studyDraft(magnetic, 'emi').loops[0].part_id, 'case');
assert.throws(() => studyDraft({ ...magnetic, loops: [{ loop_id: 'shield', part_id: 'case', board_id: 'a' }] }, 'emi'));
assert.equal(studyResultRows({ samples: [{ loops: [{ part_id: 'case', loop_id: 'shield', current_magnitude_a: .01 }] }] }, 'emi')[0].owner_kind, 'part');
const colliding = studyResultRows({ ...result, node_map: { 'Part · case': { n: 'a-feed' } }, part_node_map: { case: { n: 'a-return' } } }, 'si', 1);
assert.equal(colliding.length, 2, 'display-like board IDs never overwrite typed mechanical owners');
assert.deepEqual(colliding.map(row => [row.owner_kind ?? 'board', row.board, row.value]), [['board', 'Part · case', .8], ['part', 'case', 0]]);
console.log('Mechanical structure model admission and part-owned result rows passed.');
