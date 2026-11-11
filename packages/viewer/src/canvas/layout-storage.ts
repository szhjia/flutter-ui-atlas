import type {LayoutDocument} from './types';
export const storageKey=(key:string)=>`flutter-ui-atlas:layout:v1:${key}`;
function valid(d:any):d is LayoutDocument{
 return d?.schemaVersion===1&&[d.catalogIds,d.pendingIds].every(ids=>ids===undefined||(Array.isArray(ids)&&ids.every(id=>typeof id==='string')))&&d.nodes&&typeof d.nodes==='object'&&!Array.isArray(d.nodes)&&Object.values(d.nodes).every((n:any)=>n&&Number.isFinite(n.x)&&Number.isFinite(n.y)&&typeof n.locked==='boolean')&&d.viewport&&[d.viewport.x,d.viewport.y,d.viewport.zoom].every(Number.isFinite)&&d.viewport.zoom>=.08&&d.viewport.zoom<=1.8;
}
export interface LayoutReadResult{document:LayoutDocument|null;issue:string|null;writable:boolean;/** true = 存储里有数据但不可读或无效，可显式丢弃；存储本身不可用不算损坏 */corrupted:boolean;}
export function readLayout(storage:Storage,key:string):LayoutReadResult{
 if(!key)return {document:null,issue:'未配置布局标识，仅在本次会话保存',writable:false,corrupted:false};
 let value:string|null;
 try{value=storage.getItem(storageKey(key));}
 catch{return {document:null,issue:'布局未保存：浏览器存储不可用',writable:false,corrupted:false};}
 if(!value)return {document:null,issue:null,writable:true,corrupted:false};
 try{
  const document=JSON.parse(value);
  if(!valid(document))throw Error('布局版本不支持或数据无效');
  return {document,issue:null,writable:true,corrupted:false};
 }catch{
  return {document:null,issue:'布局数据损坏，当前使用自动整理布局。可丢弃损坏数据以恢复保存。',writable:false,corrupted:true};
 }
}
export function discardLayout(storage:Storage,key:string):{ok:boolean;issue:string|null}{
 if(!key)return {ok:false,issue:'未配置布局标识，无需丢弃'};
 try{storage.removeItem(storageKey(key));return {ok:true,issue:null};}
 catch{return {ok:false,issue:'布局未丢弃：浏览器存储不可用'};}
}
export function writeLayout(storage:Storage,key:string,document:LayoutDocument):{ok:boolean;issue:string|null}{
 const current=readLayout(storage,key);if(!current.writable)return {ok:false,issue:current.issue};
 if(!valid(document))return {ok:false,issue:'布局未保存：布局数据无效'};
 try{storage.setItem(storageKey(key),JSON.stringify(document));return {ok:true,issue:null};}catch{return {ok:false,issue:'布局未保存：浏览器存储不可用或已满'};}
}
