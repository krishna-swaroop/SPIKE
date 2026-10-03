// SPDX-License-Identifier: Apache-2.0
// Offline SVG navigation changes only the view transform and its tick labels.
export type ReportPlotSpec = { frame: [number, number, number, number]; x: [number, number]; y: [number, number]; logX?: boolean; logY?: boolean };
export function reportPlotAttributes(spec: ReportPlotSpec): string {
  return `data-spike-plot="${JSON.stringify(spec).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`;
}
export const reportPlotRuntime = String.raw`
(function(){
  'use strict';
  var ns='http://www.w3.org/2000/svg',sequence=0;
  document.querySelectorAll('svg[data-spike-plot]').forEach(function(svg){
    var spec;try{spec=JSON.parse(svg.getAttribute('data-spike-plot'));}catch(error){return;}
    var traces=svg.querySelector('[data-plot-traces]'),ticks=svg.querySelector('[data-plot-ticks]');
    if(!traces||!ticks)return;
    var f=spec.frame,x=spec.x.slice(),y=spec.y.slice(),saved=null;
    function element(name,attrs){var item=document.createElementNS(ns,name);Object.keys(attrs).forEach(function(key){item.setAttribute(key,attrs[key]);});return item;}
    var defs=element('defs',{}),clip=element('clipPath',{id:'report-plot-clip-'+(++sequence)}),wrapper=element('g',{'clip-path':'url(#report-plot-clip-'+sequence+')'});
    clip.appendChild(element('rect',{x:f[0],y:f[1],width:f[2]-f[0],height:f[3]-f[1]}));defs.appendChild(clip);svg.appendChild(defs);traces.parentNode.insertBefore(wrapper,traces);wrapper.appendChild(traces);
    var tools=document.createElement('div');tools.className='report-plot-tools';
    var fit=document.createElement('button');fit.type='button';fit.textContent='Fit plot';tools.appendChild(fit);
    var label=document.createElement('label');label.textContent='Wheel target ';var select=document.createElement('select');select.setAttribute('aria-label','Report wheel zoom target');
    [['auto','Pointer'],['x','X axis'],['y','Y axis'],['both','Both axes']].forEach(function(pair){var option=document.createElement('option');option.value=pair[0];option.textContent=pair[1];select.appendChild(option);});label.appendChild(select);tools.appendChild(label);
    var hint=document.createElement('span');hint.textContent='Wheel: zoom · Axis hover: one axis · Double-click: fit';tools.appendChild(hint);svg.parentNode.insertBefore(tools,svg);
    function format(value,log){var v=log?Math.pow(10,value):value;return v===0?'0':Math.abs(v)>=1e4||Math.abs(v)<1e-3?v.toExponential(2):Number(v.toPrecision(4)).toString();}
    function draw(){
      var ax=spec.x[1]===spec.x[0]?1:(spec.x[1]-spec.x[0])/(x[1]-x[0]||1),ay=spec.y[1]===spec.y[0]?1:(spec.y[1]-spec.y[0])/(y[1]-y[0]||1);
      var tx=f[0]-ax*(f[0]+(x[0]-spec.x[0])/(spec.x[1]-spec.x[0]||1)*(f[2]-f[0]));
      var ty=f[3]-ay*(f[3]-(y[0]-spec.y[0])/(spec.y[1]-spec.y[0]||1)*(f[3]-f[1]));
      traces.setAttribute('transform','matrix('+ax+' 0 0 '+ay+' '+tx+' '+ty+')');
      while(ticks.firstChild)ticks.removeChild(ticks.firstChild);
      for(var i=0;i<=4;i++){var fraction=i/4,px=f[0]+fraction*(f[2]-f[0]),py=f[3]-fraction*(f[3]-f[1]);
        var xt=element('text',{x:px,y:f[3]+17,'text-anchor':i===0?'start':i===4?'end':'middle'});xt.textContent=format(x[0]+fraction*(x[1]-x[0]),spec.logX);ticks.appendChild(xt);
        var yt=element('text',{x:f[0]-6,y:py+3,'text-anchor':'end'});yt.textContent=format(y[0]+fraction*(y[1]-y[0]),spec.logY);ticks.appendChild(yt);
      }
    }
    function reset(){x=spec.x.slice();y=spec.y.slice();traces.removeAttribute('transform');draw();}
    fit.addEventListener('click',reset);svg.addEventListener('dblclick',reset);svg.setAttribute('tabindex','0');svg.setAttribute('title','Wheel zoom; hover an axis for axis-only zoom; double-click to fit');
    svg.addEventListener('keydown',function(event){if(event.key==='0'){event.preventDefault();reset();}});
    svg.addEventListener('wheel',function(event){
      var matrix=svg.getScreenCTM();if(!matrix)return;var p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;p=p.matrixTransform(matrix.inverse());
      var inX=p.x>=f[0]&&p.x<=f[2],inY=p.y>=f[1]&&p.y<=f[3],zoomX=inX&&(inY||p.y>f[3]),zoomY=inY&&(inX||p.x<f[0]);
      if(!zoomX&&!zoomY)return;if(select.value==='both'){zoomX=true;zoomY=true;}if(select.value==='x')zoomY=false;if(select.value==='y')zoomX=false;
      if(spec.x[0]===spec.x[1])zoomX=false;if(spec.y[0]===spec.y[1])zoomY=false;if(!zoomX&&!zoomY)return;
      event.preventDefault();event.stopPropagation();var factor=Math.exp(Math.max(-.7,Math.min(.7,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?240:1)*.0015)));
      function range(pair,fraction){var anchor=pair[0]+(pair[1]-pair[0])*Math.max(0,Math.min(1,fraction)),result=[anchor+(pair[0]-anchor)*factor,anchor+(pair[1]-anchor)*factor];return result.every(Number.isFinite)&&result[0]!==result[1]?result:pair;}
      if(zoomX)x=range(x,(p.x-f[0])/(f[2]-f[0]));if(zoomY)y=range(y,1-(p.y-f[1])/(f[3]-f[1]));draw();
    },{passive:false});
    draw();window.addEventListener('beforeprint',function(){saved=[x.slice(),y.slice()];reset();});window.addEventListener('afterprint',function(){if(saved){x=saved[0];y=saved[1];draw();saved=null;}});
  });
})();
`;
