// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import {importTestTypescript} from "./import-test-typescript.mjs";
const {installAssemblyMovementControls}=await importTestTypescript("assemblyMovementControls");
class Canvas extends EventTarget {
  style={touchAction:"auto"}; captured=new Set();
  getBoundingClientRect(){return {left:10,top:20,width:200,height:100};}
  setPointerCapture(id){this.captured.add(id);}
  hasPointerCapture(id){return this.captured.has(id);}
  releasePointerCapture(id){this.captured.delete(id);this.send("lostpointercapture",{pointerId:id});}
  send(type, data={}) {const event=new Event(type);Object.assign(event,{button:0,pointerId:1,clientX:110,clientY:70,...data});this.dispatchEvent(event);}
}
const control=()=>({enabled:true,object:{},axis:null,dragging:false,hit:null,downs:0,moves:0,ups:0,
  disconnect(){}, pointerHover(point){this.point=point;this.axis=this.hit;},
  pointerDown(){if(this.axis){this.dragging=true;this.downs++;}},
  pointerMove(){if(this.dragging)this.moves++;},pointerUp(){this.dragging=false;this.ups++;}});
const arrows=control(),rings=control(),canvas=new Canvas();let cancels=0;
const binding=installAssemblyMovementControls(arrows,rings,canvas,()=>{cancels++;arrows.dragging=rings.dragging=false;});
rings.hit="Z";canvas.send("pointerdown");
assert.equal(rings.downs,1);assert.equal(arrows.downs,0,"a ring cannot also translate the object");
assert.deepEqual(rings.point,{x:0,y:0,button:0},"pointer positions are normalized against the canvas");
canvas.send("pointermove",{pointerId:2});assert.equal(rings.moves,0,"a second pointer cannot move an active gesture");
canvas.send("pointermove");assert.equal(rings.moves,1);
canvas.send("pointerup");assert.equal(rings.ups,1);assert.equal(cancels,1,"normal release must not cancel the numeric click transaction through lost capture");
arrows.hit="X";canvas.send("pointerdown");assert.equal(arrows.downs,1);assert.equal(rings.downs,1,"arrow handles win where a ring crosses an arrow");
canvas.send("pointercancel");assert.equal(arrows.dragging,false);assert.equal(canvas.captured.size,0);
arrows.hit=null;canvas.send("pointerdown");assert.equal(rings.downs,2,"rings remain usable after cancellation");
binding.dispose();assert.equal(rings.dragging,false);assert.equal(canvas.style.touchAction,"auto");
canvas.send("pointerdown");assert.equal(rings.downs,2,"disposing removes all pointer handlers");
console.log("Combined movement arrows and rotation rings: exclusive pointer ownership, cancel, release and cleanup passed");
