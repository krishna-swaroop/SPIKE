// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readWorkspacePreference, writeWorkspacePreference } from "../demo/workspacePreferences";
import { createWorkspaceLayout, placeWorkspacePanel } from "../src/workspace/layoutModel";

const panels = [{id:"tools",title:"Tools",defaultDock:"right"}] as const;
const key = "test-layout";

test("workspace preferences round-trip without owning assembly or result data", () => {
  const entries = new Map<string,string>();
  const storage = {getItem:(name:string)=>entries.get(name)??null,setItem:(name:string,value:string)=>{entries.set(name,value);}};
  const layout = placeWorkspacePanel(createWorkspaceLayout(panels),"tools","float");
  assert.equal(writeWorkspacePreference(storage,key,layout),true);
  assert.deepEqual(readWorkspacePreference(storage,key,panels),layout);
  assert.equal(entries.size,1);
});

test("unavailable, oversized and malformed preferences recover to a usable layout", () => {
  const defaults = createWorkspaceLayout(panels);
  for (const text of [null,"{broken", "x".repeat(32_769)]) {
    assert.deepEqual(readWorkspacePreference({getItem:()=>text,setItem:()=>{}},key,panels),defaults);
  }
  const blocked = {getItem:()=>{throw new Error("privacy");},setItem:()=>{throw new Error("quota");}};
  assert.deepEqual(readWorkspacePreference(blocked,key,panels),defaults);
  assert.deepEqual(readWorkspacePreference(undefined,key,panels),defaults);
  assert.equal(writeWorkspacePreference(blocked,key,defaults),false);
});
