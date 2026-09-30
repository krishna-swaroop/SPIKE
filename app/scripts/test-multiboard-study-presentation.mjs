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
