// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { importTestTypescript } from './import-test-typescript.mjs';
const { duplicateBoardInstance, removeBoardInstance } = await importTestTypescript('assemblyBoardLifecycle');
const transform = [1,0,0,0, 0,1,0,0, 0,0,1,12, 0,0,0,1];
const board = { id:'A', name:'Controller', design_id:'source', frame:{ frame_id:'A-frame', parent_frame_id:'assembly', transform }, extensions:{custom:{value:1}} };
const designs = { designs:[{design_id:'source',metadata:{board_size_mm:[68.58,53.34]}}] };
const assembly = { boards:[board], parts:[], harnesses:[], connector_mappings:[], rigid_flex_links:[] };
const copy = duplicateBoardInstance(assembly, designs, board, 'B');
assert.equal(copy.design_id, board.design_id, 'duplicates reuse retained source/models instead of importing another copy');
assert.equal(copy.id, 'B'); assert.equal(copy.frame.frame_id, 'B-frame');
assert.equal(copy.frame.transform[11],12); assert.equal(copy.frame.transform[3],98.58);
copy.extensions.custom.value=2;
assert.equal(board.extensions.custom.value,1,'occurrence state is not shared by reference');
assert.equal(duplicateBoardInstance({...assembly,boards:[board,copy]},designs,board,'C').name,'Controller copy 2');
assert.throws(()=>duplicateBoardInstance({...assembly,boards:[board,copy]},designs,board,'B'),/unique/);
assert.throws(()=>duplicateBoardInstance({...assembly,boards:Array.from({length:30},(_,i)=>({...board,id:String(i)}))},designs,board,'new'),/30/);
const graph = {...assembly,boards:[board,copy,{...board,id:'AA'}],
  harnesses:[{id:'wire',endpoint_a:'A::J1',endpoint_b:'B:J1'},{id:'keep',endpoint_a:'AA::J1',endpoint_b:'B::J1'}],
  connector_mappings:[{id:'connector',data:{board_id:'A',connector_id:'J1'}},{id:'mate',kind:'connector-mate',data:{endpoint_a:'A::J1',endpoint_b:'B::J1'}},{id:'keep-connector',data:{board_id:'AA',connector_id:'J1'}}],
  rigid_flex_links:[{id:'flex',data:{board_a_id:'A',board_b_id:'B'}}]};
const removed=removeBoardInstance(graph,'A');
assert.deepEqual(removed.assembly.boards.map(b=>b.id),['B','AA']);
assert.equal(removed.removedLinks,4);
assert.deepEqual(removed.assembly.harnesses.map(h=>h.id),['keep']);
assert.deepEqual(removed.assembly.connector_mappings.map(h=>h.id),['keep-connector']);
assert.deepEqual(removed.assembly.rigid_flex_links,[]);
assert.equal(graph.boards.length,3,'draft operations leave the saved input intact');
assert.equal(designs.designs.length,1,'removal preserves source for local reuse');
assert.equal(removeBoardInstance(graph,'absent').removedLinks,0);
console.log('Board lifecycle: unique local duplication, limits, dependent removal and source retention passed');
