// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import ts from "typescript";
import { importTestTypescript } from "./import-test-typescript.mjs";

const require = createRequire(import.meta.url);
const model = await importTestTypescript("assemblyBoardManagerModel");
const presentation = await importTestTypescript("assemblyManagerPresentation");
const inventory = await importTestTypescript("layerInventory");
const source = readFileSync(new URL("../src/AssemblyBoardManagers.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const hooks = { useState: value => [typeof value === "function" ? value() : value, () => {}],
  useMemo: fn => fn(), useEffect() {} };
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(id => {
  if (id === "react") return hooks;
  if (id === "./icons") return require("lucide-react");
  if (id === "./assemblyBoardManagerModel") return model;
  if (id === "./assemblyManagerPresentation") return presentation;
  if (id === "./layerInventory") return inventory;
  if (id.endsWith(".css")) return {};
  if (["./LayerManager", "./NetCatalog", "./AssemblyConnectorLinks"].includes(id)) return { default: () => null };
  return require(id);
}, module, module.exports);
const Manager = module.exports.default;
const assembly = { boards: [{id:"A", name:"A", design_id:"same"}, {id:"B", name:"B", design_id:"same"}],
  connector_mappings:[], harnesses:[] };
const designs = {active_design_id:"same", designs:[{design_id:"same", nets:[], layers:[
  {id:"top",name:"F.Cu",layer_type:"copper"}, {id:"bottom",name:"B.Cu",layer_type:"copper"},
]}]};
const visibility = {A:{"F.Cu":true,"B.Cu":false}, B:{"F.Cu":false,"B.Cu":true}};
const opacity = {A:{"F.Cu":.3}, B:{"F.Cu":.8}};
const mutations = [], focused = [];
const props = {assembly, designs, assemblyLayerVisibility:visibility, assemblyLayerOpacity:opacity,
  onAssemblyLayerVisibility:(...args)=>mutations.push(args), onAssemblyLayerOpacity:(...args)=>mutations.push(args),
  onAssemblyLayersChange:(...args)=>mutations.push(args), onFocusBoard:id=>focused.push(id),
  onSelectNet(){}, onUpdated(){}, onStatus(){}, onClose(){} };
function nodes(node) {
  return !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
}
for (const id of ["A","B","A"]) {
  const tree = nodes(Manager({...props, selectedBoardId:id}));
  const layer = tree.find(node => node.props?.toggleLayer);
  assert.equal(layer.props.layers,visibility[id],"focus restores this occurrence's layer preferences");
  assert.equal(layer.props.opacity,opacity[id]);
  layer.props.toggleLayer("F.Cu");
  assert.deepEqual(mutations.at(-1),[id,"F.Cu",visibility[id]["F.Cu"]===false]);
  layer.props.changeOpacity("F.Cu",.5);
  assert.deepEqual(mutations.at(-1),[id,"F.Cu",.5]);
  layer.props.showOnlyLayer("B.Cu");
  assert.equal(mutations.at(-1)[0],id,"bulk layer commands retain occurrence scope for duplicated designs");
  tree.find(node=>node.type==="select").props.onChange({target:{value:id==="A"?"B":"A"}});
  assert.equal(focused.at(-1),id==="A"?"B":"A","manager board choice updates viewport focus");
}
assert.deepEqual(visibility,{A:{"F.Cu":true,"B.Cu":false},B:{"F.Cu":false,"B.Cu":true}},"control dispatch does not mutate another occurrence's preferences");
console.log("Focused layer controls restore independent duplicate-board preferences and dispatch only to that occurrence");
