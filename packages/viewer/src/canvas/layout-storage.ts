import type {LayoutDocument} from './types';
export const storageKey=(key:string)=>`flutter-ui-atlas:layout:v1:${key}`;
function valid(d:any):d is LayoutDocument{
 return d?.schemaVersion===1&&[d.catalogIds,d.pendingIds].every(ids=>ids===undefined||(Array.isArray(ids)&&ids.every(id=>typeof id==='string')))&&d.nodes&&typeof d.nodes==='object'&&!Array.isArray(d.nodes)&&Object.values(d.nodes).every((n:any)=>n&&Number.isFinite(n.x)&&Number.isFinite(n.y)&&typeof n.locked==='boolean')&&d.viewport&&[d.viewport.x,d.viewport.y,d.viewport.zoom].every(Number.isFinite)&&d.viewport.zoom>=.08&&d.viewport.zoom<=1.8;
}
export function readLayout(storage:Storage,key:string):{document:LayoutDocument|null;issue:string|null;writable:boolean}{
 if(!key)return {document:null,issue:'未配置布局标识，仅在本次会话保存',writable:false};
 try{const value=storage.getItem(storageKey(key));if(!value)return {document:null,issue:null,writable:true};const d=JSON.parse(value);if(!valid(d))throw Error('布局版本不支持或数据无效');return {document:d,issue:null,writable:true};}
 catch{return {document:null,issue:'布局未保存：已有数据不可读或存储不可用，原数据未覆盖',writable:false};}
}
export function writeLayout(storage:Storage,key:string,document:LayoutDocument):{ok:boolean;issue:string|null}{
 const current=readLayout(storage,key);if(!current.writable)return {ok:false,issue:current.issue};
 if(!valid(document))return {ok:false,issue:'布局未保存：布局数据无效'};
 try{storage.setItem(storageKey(key),JSON.stringify(document));return {ok:true,issue:null};}catch{return {ok:false,issue:'布局未保存：浏览器存储不可用或已满'};}
}
