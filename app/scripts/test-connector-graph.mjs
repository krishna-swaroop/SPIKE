import assert from 'node:assert/strict';
import { ambiguousNets, graphConnectors, graphLinks, suggestedPairs, suggestionForPair } from '../src/connectorGraphModel.ts';

const assembly = {
  contract: 'spike/assembly-ir/v1', assembly_id: 'assembly', name: 'Stack', parts: [],
  boards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  harnesses: [], connector_mappings: [],
};
const discovered = {
  'a::J1': { board_id: 'a', connector_id: 'J1', position_mm: [1, 2, 0], assembly_position_mm: [1, 2, 0], pins: { '1': 'CLK', '2': 'GND', '3': '' }, discovered: true },
  'b::J2': { board_id: 'b', connector_id: 'J2', position_mm: [3, 4, 0], assembly_position_mm: [103, 4, 0], pins: { '4': 'CLK', '5': 'GND' }, discovered: true },
  'c::J3': { board_id: 'c', connector_id: 'J3', position_mm: [1, 1, 0], assembly_position_mm: [201, 1, 0], pins: { '1': 'GND' }, discovered: true },
  'unknown::J4': { board_id: 'unknown', connector_id: 'J4', pins: { '1': 'CLK' } },
};
const connectors = graphConnectors(discovered, assembly);
assert.equal(connectors.length, 3);
assert.equal(connectors[0].pins['3'], '', 'unconnected physical pins remain available for manual mapping');
assert.deepEqual(connectors[1].positionMm, [3, 4, 0]);
const suggestions = suggestedPairs(connectors, []);
assert.equal(suggestions.length, 1, 'multi-drop ground must not become an automatic connection');
assert.deepEqual(ambiguousNets(connectors, []), [{ name: 'GND', count: 3 }]);
assert.deepEqual(suggestions[0].pinMap, { '1': '4' });
assert.deepEqual(suggestionForPair(suggestions, 'b::J2', 'a::J1'), { '4': '1' });
const linked = { ...assembly, harnesses: [{ id: 'wire', endpoint_a: 'a::J1', endpoint_b: 'b::J2', pin_map: { '1': '4' } }],
  connector_mappings: [{ id: 'mate', kind: 'connector-mate', data: { endpoint_a: 'a::J1', endpoint_b: 'c::J3', pin_map: { '2': '1' } } }] };
const links = graphLinks(linked);
assert.deepEqual(links.map(link => link.kind), ['harness', 'mate']);
assert.equal(suggestedPairs(connectors, links).length, 0, 'occupied pins are never proposed again');
console.log('connector graph discovery, ambiguity, reversed map, and pin ownership passed');
