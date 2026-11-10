import {useMemo} from 'react';
import {EdgeLabelRenderer,useViewport} from '@xyflow/react';
import {placeLabels} from './place-labels';
import type {CanvasNode,RoutedEdge} from './types';
import type {MapEdge} from '../model';
export function EdgeLabels({routes,nodes,edges,focusedIds,onChoose}:{routes:RoutedEdge[];nodes:CanvasNode[];edges:MapEdge[];focusedIds:Set<string>;onChoose:(id:string)=>void}){
 const {zoom}=useViewport();
 const specs=useMemo(()=>{const ctx=document.createElement('canvas').getContext('2d');if(ctx)ctx.font='12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';return edges.map(e=>{const text=ctx?.measureText(e.action).width??e.action.length*12;const width=Math.min(160,Math.max(56,text+20)),height=text>140?44:28;return {id:e.id,size:{width:width/zoom,height:height/zoom},priority:e.status==='observed'?1:0};});},[edges,zoom]);
 const labels=placeLabels(routes,nodes,specs,zoom,focusedIds);
 return <EdgeLabelRenderer>{labels.filter(l=>l.mode!=='hidden').map(l=>{const edge=edges.find(e=>e.id===l.id)!,size=specs.find(s=>s.id===l.id)!.size;return <button key={l.id} data-edge-label={l.id} className={`atlas-edge-label nodrag nopan ${focusedIds.has(l.id)?'is-focused':''}`} title={edge.action} aria-label={`关系：${edge.action}`} style={{width:l.mode==='count'?26:size.width*zoom,height:l.mode==='count'?26:size.height*zoom,transform:`translate(-50%, -50%) translate(${l.center.x}px, ${l.center.y}px) scale(${1/zoom})`}} onClick={()=>onChoose(l.id)}><span>{l.mode==='count'?'⋯':edge.action}</span></button>;})}</EdgeLabelRenderer>;
}
