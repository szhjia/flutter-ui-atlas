import type {CanvasNode,LabelSpec,LabelPlacement,RoutedEdge,Point} from './types';
import {hasSpacingConflict,expand,type Rect} from './geometry';
export function placeLabels(routes:RoutedEdge[],nodes:CanvasNode[],labels:LabelSpec[],zoom:number,focusedIds:Set<string>):LabelPlacement[]{
 const occupied:Rect[]=nodes.map(n=>expand(n,8)),byId=new Map(routes.map(r=>[r.id,r]));
 return [...labels].sort((a,b)=>Number(focusedIds.has(b.id))-Number(focusedIds.has(a.id))||b.priority-a.priority||a.id.localeCompare(b.id)).map(label=>{
  const route=byId.get(label.id),fallback={id:label.id,center:{x:0,y:0},mode:'hidden' as const};if(!route?.points.length||(zoom<.45&&!focusedIds.has(label.id)))return fallback;
  const segments=route.points.slice(1).map((b,i)=>({a:route.points[i],b})).sort((u,v)=>Number(v.a.y===v.b.y)-Number(u.a.y===u.b.y)||Math.hypot(v.a.x-v.b.x,v.a.y-v.b.y)-Math.hypot(u.a.x-u.b.x,u.a.y-u.b.y));
  const candidates:Point[]=segments.flatMap(({a,b})=>[.5,.25,.75,.1,.9].map(t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})));
  for(const mode of ['full','count'] as const){const size=mode==='full'?label.size:{width:26/zoom,height:26/zoom};for(const center of candidates){const r={x:center.x-size.width/2,y:center.y-size.height/2,...size};if(occupied.some(o=>hasSpacingConflict(r,o,{x:8/zoom,y:6/zoom})))continue;occupied.push(r);return {id:label.id,center,mode};}}
  return fallback;
 });
}
