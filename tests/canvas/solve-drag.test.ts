import {it,expect} from 'vitest';
import {solveDrag} from '../../packages/viewer/src/canvas/solve-drag';
import {hasSpacingConflict} from '../../packages/viewer/src/canvas/geometry';
const node=(id:string,x:number,y=0,locked=false,hidden=false)=>({id,x,y,width:224,height:528,locked,hidden});
it('局部推动邻居，远处节点和起始快照不变',()=>{
 const start=[node('a',0),node('b',500),node('c',3000)];const before=structuredClone(start);
 const r=solveDrag(start,'a',{x:300,y:0});expect(r.ok).toBe(true);if(!r.ok)return;
 expect(r.nodes[1].x).toBeGreaterThanOrEqual(620);expect(r.nodes[2]).toEqual(start[2]);expect(r.affectedIds).toEqual(['b']);expect(start).toEqual(before);
 expect(r.nodes.some((a,i)=>r.nodes.slice(i+1).some(b=>hasSpacingConflict(a,b)))).toBe(false);
 expect(solveDrag(start,'a',{x:300,y:0})).toEqual(r);expect(solveDrag(start,'a',{x:0,y:0}).nodes).toEqual(start);
});
it.each(['locked','hidden'])('%s 节点不移动，被拖页寻找合法空位',flag=>{
 const start=[node('a',0),{...node('b',500),[flag]:true}];const r=solveDrag(start,'a',{x:500,y:0});
 expect(r.nodes[1]).toEqual(start[1]);if(r.ok)expect(hasSpacingConflict(...r.nodes as [any,any])).toBe(false);
});
it('锁定页不能主动移动，非法数值不进入布局，负坐标可用',()=>{
 expect(solveDrag([node('a',0,0,true)],'a',{x:30,y:0}).ok).toBe(false);
 expect(solveDrag([node('a',0)],'a',{x:NaN,y:0}).ok).toBe(false);
 expect(solveDrag([node('a',0)],'a',{x:-500,y:-200}).nodes[0].x).toBe(-500);
});
it('求解超过局部范围不会推动远处链条',()=>{
 const start=Array.from({length:15},(_,i)=>node(String(i),i*320));const r=solveDrag(start,'0',{x:100,y:0});
 if(r.ok){expect(r.affectedIds.length).toBeLessThanOrEqual(12);expect(r.nodes[14]).toEqual(start[14]);}else expect(r.nodes).toEqual(start);
});
