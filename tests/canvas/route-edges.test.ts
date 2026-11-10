import {expect,it} from 'vitest';
import {routeEdges} from '../../packages/viewer/src/canvas/route-edges';
import {segmentHits,expand} from '../../packages/viewer/src/canvas/geometry';
const n=(id:string,x:number,y=0)=>({id,x,y,width:224,height:528,hidden:false,locked:false});
it('绕开中间页面，反向与自环有独立路径',()=>{const nodes=[n('a',0),n('b',400),n('c',800)];const edges=[{id:'ac',source:'a',target:'c',action:'打开'},{id:'ca',source:'c',target:'a',action:'返回'},{id:'aa',source:'a',target:'a',action:'刷新'}];const r=routeEdges(nodes,edges,[],new Set());expect(r.every(e=>e.status==='routed')).toBe(true);for(const e of r)for(let i=1;i<e.points.length;i++)expect(segmentHits(e.points[i-1],e.points[i],expand(nodes[1]))).toBe(false);expect(r[0].points).not.toEqual([...r[1].points].reverse());expect(r[2].points.length).toBeGreaterThan(3);});
it('移动远处节点不改已合法路径',()=>{const ns=[n('a',0),n('b',800),n('far',5000)];const es=[{id:'ab',source:'a',target:'b',action:''}];const first=routeEdges(ns,es,[],new Set());expect(routeEdges([...ns.slice(0,2),n('far',6000)],es,first,new Set(['far']))[0]).toBe(first[0]);});
