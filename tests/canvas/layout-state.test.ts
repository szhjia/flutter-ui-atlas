import {it,expect} from 'vitest';
import {commitLayout,undoLayout,redoLayout} from '../../packages/viewer/src/canvas/layout-state';
import type {LayoutHistory,LayoutDocument} from '../../packages/viewer/src/canvas/types';
const doc=(x=0):LayoutDocument=>({schemaVersion:1,nodes:{a:{x,y:0,locked:false},b:{x:x+500,y:0,locked:true}},viewport:{x:0,y:0,zoom:.65}});
it('一次提交/撤销恢复整组，新操作清空重做，历史最多50',()=>{
 let h:LayoutHistory={present:doc(),past:[],future:[]};h=commitLayout(h,doc(20));expect(undoLayout(h).present).toEqual(doc());expect(redoLayout(undoLayout(h)).present).toEqual(doc(20));
 expect(commitLayout(undoLayout(h),doc(30)).future).toEqual([]);
 for(let i=1;i<60;i++)h=commitLayout(h,doc(i));expect(h.past.length).toBe(50);expect(commitLayout(h,h.present)).toEqual(h);
});
