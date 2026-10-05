// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { importTestTypescript } from "./import-test-typescript.mjs";
const { assemblyNetHighlight } = await importTestTypescript("assemblyNetHighlight");

const component = (id, ref) => ({ id, ref, value: "", library: "", at: [0, 0], width: 1, height: 1, rotation: 0, layer: "F.Cu", modelOffset: [0, 0, 0], modelScale: [1, 1, 1], modelRotation: [0, 0, 0] });
const pad = (id, ref, name, net) => ({ id, ref, name, net, at: [0, 0], width: 1, height: 1, rotation: 0, shape: "rect", drill: 0, layers: ["F.Cu"], layer: "F.Cu" });
const board = (suffix) => ({ width: 10, height: 10, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, outlineLoops: [], tracks: [], vias: [], zones: [], drawings: [], layers: ["F.Cu"], layerDefinitions: [], stackup: [],
  nets: { [`sig-${suffix}`]: "SIG", [`next-${suffix}`]: "NEXT", [`gnd-${suffix}`]: "GND" },
  components: [component("j", "J1"), component("u", "U1"), component("load", "R1")],
  pads: [pad("j1", "J1", "1", "SIG"), pad("j2", "J1", "2", "GND"), pad("u1", "U1", "1", "SIG"), pad("u2", "U1", "2", "NEXT"), pad("u3", "U1", "3", "GND"), pad("r1", "R1", "1", "NEXT")] });

const boards = { left: board("l"), right: board("r"), isolated: board("i") };
const assembly = { harnesses: [{ endpoint_a: "left::J1", endpoint_b: "right::J1", pin_map: { "1": "1", "2": "2" } }], connector_mappings: [] };

const linked = assemblyNetHighlight({ boards, assembly, seed: { kind: "net", boardId: "left", netId: "sig-l" } });
assert.deepEqual(linked.nets.map(row => [row.boardId, row.netId]), [["left", "sig-l"], ["right", "sig-r"]]);
assert.ok(!linked.nets.some(row => row.boardId === "isolated"), "equal names never connect board occurrences");
assert.deepEqual(linked.componentBoundaries.map(row => `${row.boardId}::${row.componentId}`), ["left::j", "left::u", "right::j", "right::u"]);

const through = assemblyNetHighlight({ boards, assembly, seed: { kind: "component", boardId: "left", componentId: "u" } });
assert.deepEqual(through.nets.map(row => row.netId), ["next-l", "sig-l", "sig-r"]);
assert.ok(!through.nets.some(row => row.netName === "GND"), "component pass-through excludes ground nets");
assert.deepEqual(through.componentBoundaries.map(row => `${row.boardId}::${row.componentId}`), ["left::j", "left::load", "right::j", "right::u"], "traversal stops at boundary components");

const expanded = assemblyNetHighlight({ boards, assembly, seed: { kind: "net", boardId: "left", netId: "sig-l" }, passThroughComponents: ["right::u"] });
assert.deepEqual(expanded.nets.filter(row => row.boardId === "right").map(row => row.netId), ["next-r", "sig-r"]);
assert.ok(!expanded.nets.some(row => row.netId === "gnd-r"));
assert.deepEqual(expanded.componentBoundaries.filter(row => row.boardId === "right").map(row => row.componentId), ["j", "load"]);

const ambiguousBoards = {
  a: { ...board("a"), nets: { "net-a": "DUP", "net-a2": "DUP" }, pads: [pad("ja1", "J1", "1", "net-a"), pad("ja2", "J1", "2", "DUP")] },
  b: { ...board("b"), nets: { "net-b": "DUP", "net-b2": "DUP" }, pads: [pad("jb1", "J1", "1", "net-b"), pad("jb2", "J1", "2", "DUP")] },
};
const exactAssembly = { harnesses: [{ endpoint_a: "a::J1", endpoint_b: "b::J1", pin_map: { "1": "1", "2": "2" } }], connector_mappings: [
  { id: "a-j", kind: "connector", data: { board_id: "a", connector_id: "J1", pins: { "1": "net-a", "2": "DUP" } } },
  { id: "b-j", kind: "connector", data: { board_id: "b", connector_id: "J1", pins: { "1": "net-b", "2": "DUP" } } },
] };
const exact = assemblyNetHighlight({ boards: ambiguousBoards, assembly: exactAssembly, seed: { kind: "net", boardId: "a", netId: "net-a" } });
assert.deepEqual(exact.nets.map(row => [row.boardId, row.netId]), [["a", "net-a"], ["b", "net-b"]], "canonical IDs resolve despite duplicate display names");
assert.equal(exact.unresolvedPinLinks.length, 1, "ambiguous display names do not create a cross-board edge");

const groundMappedAssembly = { harnesses: [{ endpoint_a: "left::J1", endpoint_b: "right::J1", pin_map: { "1": "2" } }], connector_mappings: [] };
const componentGroundMap = assemblyNetHighlight({ boards, assembly: groundMappedAssembly, seed: { kind: "component", boardId: "left", componentId: "u" } });
assert.ok(!componentGroundMap.nets.some(row => row.netName === "GND"), "component traversal does not cross a pin map onto remote ground");
const directGround = assemblyNetHighlight({ boards, assembly, seed: { kind: "net", boardId: "left", netId: "gnd-l" } });
assert.deepEqual(directGround.nets.map(row => row.netId), ["gnd-l", "gnd-r"], "direct canonical ground selection remains supported");
console.log("Assembly scoped linked-net and pass-through highlighting passed");

const {assemblyHighlightBoard,resolveAssemblyNetId,uniqueNetIdsByName}=await importTestTypescript("assemblyNetIdentity");
const parsed=board("l"); parsed.nets={"1":"SIG","2":"NEXT","3":"GND"}; parsed.pads=parsed.pads.map(p=>({...p,net:({SIG:"1",NEXT:"2",GND:"3"})[p.net],ref:p.ref==='U1'?'u':p.ref}));
const rebound=assemblyHighlightBoard(parsed,board("l").nets);
const reboundThrough=assemblyNetHighlight({boards:{left:rebound,right:board("r"),copy:rebound},assembly,seed:{kind:"component",boardId:"left",componentId:"u"}});
assert.deepEqual(reboundThrough.nets.map(n=>[n.boardId,n.netId]),[["left","next-l"],["left","sig-l"],["right","sig-r"]],"parser aliases and component IDs traverse only explicitly linked occurrences");
const invalidDeclared={...assembly,connector_mappings:[{kind:"connector",data:{board_id:"left",connector_id:"J1",pins:{"1":"gone"}}}]};
const invalid=assemblyNetHighlight({boards,assembly:invalidDeclared,seed:{kind:"net",boardId:"left",netId:"sig-l"}});
assert.deepEqual(invalid.nets.map(n=>n.boardId),["left"],"an invalid retained pin cannot be silently replaced by parser fallback");
assert.ok(invalid.unresolvedPinLinks.some(link=>link.pinA==='1'));
const duplicates={a:"DUP",b:"DUP",c:"OK"};
assert.equal(resolveAssemblyNetId(parsed,duplicates,uniqueNetIdsByName(duplicates),"DUP"),null,"ambiguous geometry names must not choose a random canonical net");
assert.equal(resolveAssemblyNetId(parsed,duplicates,uniqueNetIdsByName(duplicates),"a"),"a","exact canonical IDs survive duplicate names");

const conflictBoards={...boards,left:{...boards.left,pads:[...boards.left.pads,pad("conflict","J1","1","NEXT")]}};
const conflicting=assemblyNetHighlight({boards:conflictBoards,assembly,seed:{kind:"net",boardId:"left",netId:"sig-l"}});
assert.deepEqual(conflicting.nets.map(n=>n.boardId),["left"],"conflicting retained pin ownership must not create an arbitrary cross-board edge");
const hierarchical={...board("l"),nets:{...board("l").nets,"gnd-l":"/power/GND"},pads:board("l").pads.map(p=>({...p,net:p.net==='GND'?'/power/GND':p.net}))};
assert.ok(!assemblyNetHighlight({boards:{left:hierarchical},assembly:{},seed:{kind:"component",boardId:"left",componentId:"u"}}).nets.some(n=>n.netId==='gnd-l'),"hierarchical ground names stay excluded from component traversal");
