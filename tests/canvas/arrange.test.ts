import {it,expect} from 'vitest';
import {arrangeNodes} from '../../packages/viewer/src/canvas/arrange';
import {hasSpacingConflict} from '../../packages/viewer/src/canvas/geometry';
const nodes=['a','b','c','d'].map(id=>({id,x:0,y:0,width:224,height:528,locked:false,hidden:false}));
const edges=[['a','b'],['b','a'],['b','c']].map(([source,target])=>({id:source+target,source,target,action:'下一页'}));
it('循环、分叉和断开子图初排无重叠、确定性',()=>{const r=arrangeNodes(nodes,edges,new Set(nodes.map(n=>n.id)));expect(r.ok).toBe(true);expect(r.nodes.some((a,i)=>r.nodes.slice(i+1).some(b=>hasSpacingConflict(a,b,{x:160,y:120})))).toBe(false);expect(arrangeNodes(nodes,edges,new Set(nodes.map(n=>n.id)))).toEqual(r);});
it('只整理可见可移动节点，固定节点坐标不变',()=>{const input=nodes.map(n=>n.id==='a'?{...n,x:100,y:100,locked:true}:n);const r=arrangeNodes(input,edges,new Set(['b','c','d']));expect(r.ok).toBe(true);expect(r.nodes[0]).toEqual(input[0]);});

it('主流程排在孤立状态前，首次打开即可看到入口',()=>{const input=[{...nodes[0],id:'empty'},...nodes.map(n=>({...n,id:'z'+n.id}))];const links=[{id:'z',source:'za',target:'zb',action:''}];const r=arrangeNodes(input,links,new Set(input.map(n=>n.id)));expect(r.nodes.find(n=>n.id==='za')!.y).toBe(0);expect(r.nodes.find(n=>n.id==='empty')!.y).toBeGreaterThan(528);});
