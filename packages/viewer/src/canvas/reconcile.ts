import type {CanvasNode,EdgeSpec,LayoutDocument,ReconcileResult} from './types';
import {arrangeNodes,nearestFree} from './arrange';
import {hasSpacingConflict} from './geometry';
export function reconcileLayout(document:LayoutDocument|null,nodes:CanvasNode[],edges:EdgeSpec[],previousIds?:Set<string>):ReconcileResult{
 if(!document){const r=arrangeNodes(nodes,edges,new Set(nodes.map(n=>n.id)));return {document:{schemaVersion:1,nodes:Object.fromEntries(r.nodes.map(n=>[n.id,{x:n.x,y:n.y,locked:n.locked}])),viewport:{x:40,y:35,zoom:.65},catalogIds:nodes.map(n=>n.id),pendingIds:[]},pendingIds:[],conflictIds:[]};}
 const knownIds=previousIds??(document.catalogIds?new Set(document.catalogIds):undefined);
 const existingIds=knownIds?new Set([...knownIds].filter(id=>!document.pendingIds?.includes(id))):undefined;
 const next=structuredClone(document),occupied:CanvasNode[]=[],pendingIds:string[]=[],conflicts=new Set<string>();
 const ordered=[...nodes].sort((a,b)=>Number(!existingIds?.has(a.id))-Number(!existingIds?.has(b.id))||Number(!next.nodes[a.id])-Number(!next.nodes[b.id])||a.id.localeCompare(b.id));
 for(const n of ordered){const saved=next.nodes[n.id],candidate={...n,...saved};const returning=!!saved&&((!!existingIds&&!existingIds.has(n.id))||!!document.pendingIds?.includes(n.id));
  if(saved&&!returning){occupied.push(candidate);continue;}
  if(saved&&returning&&saved.locked){if(occupied.some(other=>hasSpacingConflict(candidate,other)))pendingIds.push(n.id);else occupied.push(candidate);continue;}
  const neighborId=edges.flatMap(e=>e.source===n.id?[e.target]:e.target===n.id?[e.source]:[]).find(id=>occupied.some(o=>o.id===id));
  const neighbor=occupied.find(o=>o.id===neighborId);const origin=saved??(neighbor?{x:neighbor.x+neighbor.width+160,y:neighbor.y}:{x:0,y:Math.max(-240,...occupied.map(n=>n.y+n.height))+240});
  const p=nearestFree(candidate,occupied,origin);if(!p){pendingIds.push(n.id);continue;}next.nodes[n.id]={...p,locked:saved?.locked??false};occupied.push({...candidate,...p});
 }
 for(let i=0;i<occupied.length;i++)for(let j=i+1;j<occupied.length;j++)if(hasSpacingConflict(occupied[i],occupied[j])){conflicts.add(occupied[i].id);conflicts.add(occupied[j].id);}
 next.catalogIds=nodes.map(n=>n.id);next.pendingIds=pendingIds;
 return {document:next,pendingIds,conflictIds:[...conflicts]};
}
