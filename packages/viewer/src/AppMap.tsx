import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps, type Edge, MarkerType} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './app-map.css';
import {type AppMapManifest, type CaptureAttempt, type MapScreen, visibleEdges, visibleScreens} from './model';

import {useCanvasController,isEditingTarget} from './canvas/useCanvasController';
import {CanvasToolbar} from './canvas/CanvasToolbar';
import {AtlasEdge} from './canvas/AtlasEdge';
import {EdgeLabels} from './canvas/EdgeLabels';
import {routeEdges} from './canvas/route-edges';
import type {CanvasNode,RoutedEdge} from './canvas/types';
type ScreenNode = Node<{screen: MapScreen;locked:boolean;ghost:boolean;toggle:()=>void}, 'screen'>;
function ScreenCard({data, selected}: NodeProps<ScreenNode>) {
  const s = data.screen;
  if(data.ghost)return <div className="atlas-ghost">筛选隐藏 · {s.title}</div>;
  return <article className={`map-card ${selected?'is-selected':''}`}>
    <Handle type="target" position={Position.Left}/>
    <div className="map-card-label"><span>{s.role} · {s.group}</span><span>{s.status==='captured'?'已采集':s.status==='pending'?'待采集':'失败'}</span></div>
    <h2>{s.title}<button className="atlas-lock nodrag nopan" aria-label={`${data.locked?'解锁':'锁定'}${s.title}`} onClick={e=>{e.stopPropagation();data.toggle();}}>{data.locked?'●':'○'}</button></h2>
    {s.image ? <img src={s.image} alt={`${s.role} · ${s.title}真实页面`} draggable={false}/> : <div className="map-capture-error">{s.status==='pending'?'待采集':'采集失败'}<br/>{s.error}</div>}
    <footer>{s.state}</footer>
    <Handle type="source" position={Position.Right}/>
  </article>;
}
const MemoScreenCard=memo(ScreenCard,(a,b)=>a.selected===b.selected&&a.data.screen===b.data.screen&&a.data.locked===b.data.locked&&a.data.ghost===b.data.ghost&&a.data.toggle===b.data.toggle);
const nodeTypes = {screen: MemoScreenCard};
const edgeTypes={atlas:AtlasEdge};
export interface AtlasViewerAdapter {
  layoutKey?: string;
  loadManifest(): Promise<AppMapManifest>;
  loadLatestAttempt?(): Promise<CaptureAttempt | null>;
  previewUrl?(screen: MapScreen, sessionId: string): string | null;
  isolatedPreview?: boolean;
  sourceFingerprint?(): Promise<string | null>;
  title?: string;
  homeUrl?: string;
  captureHint?: string;
  sharedRoles?: string[];
}

const edgeColor = (status: string)=>status==='observed'?'#287d78':status==='failed'?'#b75b48':'#909aab';

function AttemptNotice({attempt, hasMap}: {attempt: CaptureAttempt | null; hasMap: boolean}) {
  if (attempt?.status !== 'failed') return null;
  return <div className="atlas-notice" role="status">
    最近采集失败{hasMap?'，当前显示上一次成功结果':''}。{attempt.error?.split('\n', 1)[0]} <a href={attempt.report} target="_blank" rel="noreferrer">查看采集报告 ↗</a>
  </div>;
}

type CoverageView = 'flow' | 'unlinked' | 'all';

function MapCanvas({map, attempt, refresh, adapter}: {map: AppMapManifest; attempt: CaptureAttempt | null; refresh: ()=>void; adapter: AtlasViewerAdapter}) {
  const groupOrder = useMemo(()=>[...new Set(map.screens.map(s=>s.group))],[map]);
  const roles = useMemo(()=>[...new Set(map.screens.map(s=>s.role))],[map]);
  const compare = (a:MapScreen,b:MapScreen)=>roles.indexOf(a.role)-roles.indexOf(b.role)||groupOrder.indexOf(a.group)-groupOrder.indexOf(b.group);

  const [role,setRole] = useState('全部');
  const [coverage, setCoverage] = useState<CoverageView>('flow');
  const [group,setGroup] = useState('全部');
  const [query,setQuery] = useState('');
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [live,setLive] = useState<{id:string;url:string}|null>(null);
  const [previewError,setPreviewError] = useState('');
  const [allEdges,setAllEdges] = useState(Boolean(map.discovery));
  const [selectedEdge,setSelectedEdge]=useState<string|null>(null);
  const [collapsed,setCollapsed]=useState(false);
  const [source,setSource] = useState<string|null>(null);

  const flow = useReactFlow<ScreenNode>();
  useEffect(()=>{
    let current = true;
    const check = ()=>(adapter.sourceFingerprint?.()??Promise.resolve(null)).then(value=>{if(current)setSource(value);}).catch(()=>{if(current)setSource(null);});
    void check(); const timer=window.setInterval(check,30000);
    return ()=>{current=false;window.clearInterval(timer);};
  },[adapter]);
  const verifiedIds = useMemo(() => new Set(map.edges.filter(edge => edge.status === 'observed')
    .flatMap(edge => [edge.source, edge.target])), [map.edges]);
  const scope = !map.discovery || coverage === 'flow' && !verifiedIds.size ? 'all' : coverage;
  const scopedCount = scope === 'all' ? map.screens.length
    : scope === 'flow' ? verifiedIds.size : map.screens.length - verifiedIds.size;
  const screens = useMemo(() => visibleScreens(map, role, group, query, adapter.sharedRoles)
    .filter(screen => scope === 'all' || verifiedIds.has(screen.id) === (scope === 'flow'))
    .sort(compare), [map, role, group, query, adapter.sharedRoles, scope, verifiedIds]);
  const selected = screens.find(s=>s.id===selectedId)??null;
  const relations = map.edges.filter(e=>e.source===selected?.id||e.target===selected?.id);
  const entrances = relations.filter(edge => edge.target === selected?.id && edge.status === 'observed');
  const visibleIds=useMemo(()=>new Set(screens.map(s=>s.id)),[screens]);
  const controller=useCanvasController({map,layoutKey:adapter.layoutKey,visibleIds});
  const {nodes:geometry}=controller;
  const controllerRef=useRef(controller);controllerRef.current=controller;
  const toggles=useRef(new Map<string,()=>void>());
  const lockAction=(id:string)=>{if(!toggles.current.has(id))toggles.current.set(id,()=>controllerRef.current.toggleLock(id));return toggles.current.get(id)!;};
  const active=geometry.find(n=>n.id===controller.draggingId);
  const nodes:ScreenNode[]=geometry.filter(n=>map.screens.some(s=>s.id===n.id)&&(!n.hidden||(active&&Math.hypot(n.x-active.x,n.y-active.y)<1400))).map(n=>({id:n.id,type:'screen',data:{screen:map.screens.find(s=>s.id===n.id)!,locked:n.locked,ghost:n.hidden,toggle:lockAction(n.id)},position:{x:n.x,y:n.y},measured:{width:n.width,height:n.height},selected:n.id===selectedId,draggable:!n.locked&&!n.hidden,selectable:!n.hidden,focusable:!n.hidden,style:n.hidden?{width:n.width,height:n.height,pointerEvents:'none'}:undefined}));
  const shownEdges=visibleEdges(map.edges,screens).filter(e => (scope !== 'flow' || e.status === 'observed') &&
    (allEdges || !selected || e.source === selected.id || e.target === selected.id));
  const cache=useRef<{nodes:CanvasNode[];routes:RoutedEdge[];signature:string}>({nodes:[],routes:[],signature:''});
  const signature=shownEdges.map(e=>`${e.id}:${e.source}:${e.target}`).join('|');
  const changedIds=new Set(geometry.filter(n=>{const old=cache.current.nodes.find(o=>o.id===n.id);return !old||old.x!==n.x||old.y!==n.y||old.width!==n.width||old.height!==n.height;}).map(n=>n.id));
  const routes=routeEdges(geometry,shownEdges,cache.current.signature===signature?cache.current.routes:[],changedIds);
  cache.current={nodes:geometry,routes,signature};
  const edges:Edge[]=shownEdges.map(e=>({id:e.id,source:e.source,target:e.target,type:'atlas',data:{points:routes.find(r=>r.id===e.id)?.points},markerEnd:{type:MarkerType.ArrowClosed,color:edgeColor(e.status)},style:{stroke:edgeColor(e.status),strokeWidth:e.id===selectedEdge?2.5:1.5,strokeDasharray:e.status==='observed'?undefined:'6 5'}}));
  const focusedIds=new Set(shownEdges.filter(e=>e.id===selectedEdge||e.source===selectedId||e.target===selectedId).map(e=>e.id));
  useEffect(()=>{void flow.setViewport(controller.viewport);},[controller.viewport.x,controller.viewport.y,controller.viewport.zoom]);
  const edgeDetail=map.edges.find(e=>e.id===selectedEdge);
  const choose = useCallback((id:string)=>{setSelectedId(id);setSelectedEdge(null);setLive(null);setPreviewError('');},[]);
  const resetFilters = (nextRole:string,nextGroup:string,nextQuery:string)=>{
    setRole(nextRole);setGroup(nextGroup);setQuery(nextQuery);setSelectedId(null);setLive(null);
  };
  const stale = source!==null&&source!==map.sourceFingerprint;
  function openPreview(screen: MapScreen) {
    try {
      const url = adapter.previewUrl?.(screen, `map-live-${crypto.randomUUID()}`);
      if (!url) throw Error('当前页面未配置实时预览地址');
      setLive({id:screen.id,url});
      setPreviewError('');
    } catch (error) {
      setPreviewError(String(error instanceof Error ? error.message : error));
    }
  }
  return <main className="app-map" onKeyDownCapture={e=>{
    if(isEditingTarget(e.target))return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();controller.cancelDrag();return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();e.shiftKey?controller.redo():controller.undo();return;}
    if(selectedId&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();controller.moveByKeyboard(selectedId,{x:e.key==='ArrowLeft'?-10:e.key==='ArrowRight'?10:0,y:e.key==='ArrowUp'?-10:e.key==='ArrowDown'?10:0});}
  }}>
    <header className="map-topbar">
      <div className="map-brand"><span className="map-logo">A</span><div><h1>{adapter.title??'UI Atlas'} <span>UI 画布</span></h1><p>从页面全貌，走进真实体验</p></div></div>
      <div className="map-top-actions"><span>{map.screens.filter(s=>s.status==='captured').length} 个已采集页面{map.discovery&&` · ${map.screens.filter(s=>s.status==='pending').length} 个待采集`} · {map.edges.filter(e=>e.status==='observed').length} 条已验证连线</span><button onClick={refresh}>刷新采集结果</button>{adapter.homeUrl&&<a href={adapter.homeUrl}>返回工作台 ↗</a>}</div>
    </header>
    <AttemptNotice attempt={attempt} hasMap/>
    <div className="map-toolbar">
      <div className="map-segment" aria-label="身份筛选">{['全部',...roles.filter(r=>!adapter.sharedRoles?.includes(r))].map(item=><button key={item} aria-pressed={role===item} onClick={()=>resetFilters(item,group,query)}>{item==='全部'?'全部身份':`${item}空间`}</button>)}</div>
      <select aria-label="功能分组" value={group} onChange={e=>resetFilters(role,e.target.value,query)}><option value="全部">全部功能</option>{groupOrder.map(g=><option key={g}>{g}</option>)}</select>
      <input aria-label="搜索页面" placeholder="搜索页面或路由…" value={query} onChange={e=>resetFilters(role,group,e.target.value)}/>
      {map.discovery&&<select aria-label="页面覆盖范围" value={scope} onChange={event=>{
        setCoverage(event.target.value as CoverageView);
        setSelectedEdge(null);
        resetFilters(role,group,query);
      }}>
        <option value="flow" disabled={!verifiedIds.size}>已验证流程（{verifiedIds.size}）</option>
        <option value="unlinked">未连入流程（{map.screens.length - verifiedIds.size}）</option>
        <option value="all">全部页面（{map.screens.length}）</option>
      </select>}
      <span className="map-count">显示 {screens.length} / {scopedCount}</span>
      <CanvasToolbar canUndo={controller.canUndo} canRedo={controller.canRedo} undo={controller.undo} redo={controller.redo} arrange={controller.arrangeVisible} count={geometry.filter(n=>!n.hidden&&!n.locked).length} locked={geometry.find(n=>n.id===selectedId)?.locked} onLock={selectedId?()=>controller.toggleLock(selectedId):undefined}/>
      <button onClick={()=>void flow.fitView({padding:.08,duration:300,minZoom:.08,maxZoom:.8})}>查看全貌</button>
    </div>
    {(controller.issue||controller.externalAvailable||controller.pendingIds.length>0||controller.conflictIds.length>0)&&<div className="atlas-notice" role="status">{controller.issue} {controller.conflictIds.length>0&&`有 ${controller.conflictIds.length} 个页面尺寸变化后间距不足，请手动移动或整理。`}{controller.externalAvailable&&<><span>另一窗口已更新布局。</span><button onClick={controller.loadExternalLayout}>载入外部布局</button><button onClick={controller.keepLocalLayout}>保留当前布局</button></>}{controller.pendingIds.map(id=><span key={id}>待定位：{map.screens.find(s=>s.id===id)?.title}<button onClick={()=>controller.toggleLock(id)}>解锁并定位</button></span>)}</div>}
    <div className="map-main">
      <section className="map-stage" aria-label="页面关系画布">
        <ReactFlow<ScreenNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} minZoom={.08} maxZoom={1.8}
          onNodesChange={changes=>{controller.onMeasured(changes.flatMap(c=>c.type==='dimensions'&&c.dimensions?[{id:c.id,size:c.dimensions}]:[]));const selection=changes.find(c=>c.type==='select'&&c.selected);if(selection?.type==='select')choose(selection.id);}}
          ariaLabelConfig={{'controls.ariaLabel':'画布控制','controls.zoomIn.ariaLabel':'放大','controls.zoomOut.ariaLabel':'缩小','controls.fitView.ariaLabel':'适应画布','minimap.ariaLabel':'页面缩略地图','handle.ariaLabel':'页面连接点','node.a11yDescription.default':'按回车选择页面，方向键移动，Esc 取消。','edge.a11yDescription.default':'页面之间的导航关系。'}}
          defaultViewport={controller.viewport} onMoveEnd={(_,viewport)=>controller.onViewportCommit(viewport)} nodesConnectable={false} deleteKeyCode={null}
          onNodeClick={(_,node)=>choose(node.id)} onNodeDragStart={(_,node)=>controller.onDragStart(node.id)} onNodeDrag={(_,node)=>{if(node)controller.onDrag(node.id,node.position);}} onNodeDragStop={(_,node)=>{if(node)controller.onDragStop(node.id,node.position);}}
          onEdgeClick={(_,edge)=>setSelectedEdge(edge.id)} onEdgeMouseEnter={(_,edge)=>setSelectedEdge(edge.id)}
          onPaneClick={()=>{setSelectedId(null);setLive(null);}}>
          <EdgeLabels routes={routes} nodes={geometry} edges={shownEdges} focusedIds={focusedIds} onChoose={setSelectedEdge}/>
          <Background color="#d6dce5" gap={24} size={1}/><Controls showInteractive={false}/>
          <MiniMap style={{width:125,height:90}} pannable zoomable nodeColor={n=>['#81a8cd','#d8ba77','#91b4aa'][roles.indexOf((n.data.screen as MapScreen).role)%3]}/>
        </ReactFlow>
        {!screens.length&&<div className="map-no-results">没有匹配的页面，请调整筛选。</div>}
        <div className="map-legend"><span>{routes.filter(r=>r.status==='unroutable').length>0?`${routes.filter(r=>r.status==='unroutable').length} 条关系空间不足；选页查看列表`: '自由布局 · 拖动局部避让'}</span><span><i/>实际点击验证</span><span><i className="declared"/>声明关系，未验证</span><label><input type="checkbox" checked={allEdges} onChange={e=>setAllEdges(e.target.checked)}/>始终显示全部连线</label></div>
      </section>
      <button className="atlas-inspector-toggle" aria-label={collapsed?'展开详情':'收起详情'} onClick={()=>setCollapsed(!collapsed)}>{collapsed?'‹':'›'}</button>
      <aside hidden={collapsed} className={`map-inspector ${live?'map-inspector-live':''}`}>
        {edgeDetail&&<div className="atlas-edge-detail"><h3>导航关系</h3><b>{map.screens.find(s=>s.id===edgeDetail.source)?.title} → {map.screens.find(s=>s.id===edgeDetail.target)?.title}</b><p>{edgeDetail.action}{edgeDetail.recordingSources?.length ? ` · ${edgeDetail.recordingSources.map(source => source==='manual'?'手动录制':'测试录制').join('、')}` : ''}</p><span>{edgeDetail.status==='observed'?'实际点击已验证':edgeDetail.status==='failed'?'验证失败':'声明关系，未验证'}</span><button onClick={()=>setSelectedEdge(null)}>关闭关系</button></div>}
        {selected?<>
          <div className="map-inspector-heading"><span>{selected.role} / {selected.group}</span><button aria-label="关闭页面详情" onClick={()=>{setSelectedId(null);setLive(null);}}>×</button></div>
          <h2>{selected.title}</h2><code>{selected.route}</code>
          {map.discovery&&<div className="map-muted">
            <p>页面来源　{selected.discoverySource || '浏览器观测'}</p>
            <p>应用入口　{selected.entry}</p>
            <p>{entrances.length ? `有 ${entrances.length} 条已验证的进入路径`
              : selected.status === 'captured' ? '已有截图，尚无已验证的进入路径'
              : '待采集候选，尚无已验证的进入路径'}</p>
          </div>}
          <div className="map-preview-tabs"><button aria-pressed={!live} onClick={()=>{setLive(null);setPreviewError('');}}>采集截图</button>{adapter.previewUrl&&(!map.discovery||selected.status==='captured')&&<button aria-pressed={live?.id===selected.id} onClick={()=>openPreview(selected)}>实时操作</button>}</div>
          {previewError&&<p role="alert">{previewError}</p>}
          {live?.id===selected.id?<><p className="map-live-hint">{adapter.isolatedPreview?'独立演示会话':'实时 Web 预览'} · {map.viewport.width} × {map.viewport.height}<br/>需 App 服务运行；切换页面会关闭此预览。</p><div className="map-live-box" style={{width:map.viewport.width+2,height:map.viewport.height+2}}><iframe style={{width:map.viewport.width,height:map.viewport.height}} title={`${selected.title}实时预览`} src={live.url}/></div><a className="map-open" href={live.url} target="_blank" rel="noreferrer">在独立窗口操作 ↗</a></>:
            selected.image?<a href={selected.image} target="_blank" rel="noreferrer"><img className="map-detail-image" src={selected.image} alt={`${selected.title}完整截图`}/></a>:<p role={selected.status==='failed'?'alert':undefined}>{selected.status==='pending'?'待采集 · ':''}{selected.error}</p>}
          <h3>页面关系 · {relations.length}</h3>
          {relations.length?relations.map(edge=>{const target=map.screens.find(s=>s.id===(edge.source===selected.id?edge.target:edge.source));return <button className="map-relation" key={edge.id} title={edge.reason ?? edge.sourceFile} onClick={()=>{if(target){setQuery('');setGroup('全部');setRole('全部');if(scope !== 'all' && verifiedIds.has(target.id) !== (scope === 'flow'))setCoverage('all');choose(target.id);const p=geometry.find(n=>n.id===target.id)??{x:0,y:0};void flow.setCenter(p.x+112,p.y+250,{zoom:.75,duration:300});}}}><b>{edge.source===selected.id?'→':'←'} {target?.title}</b><span>{edge.action} · {edge.status==='observed'?'已验证':edge.status==='failed'?'验证失败':'未验证'}</span></button>}):<p className="map-muted">尚未登记该页连线。页面截图不代表入口流程已验证。</p>}
          <p className="map-muted">{!map.discovery&&selected.discoverySource&&`${selected.discoverySource} · `}{selected.state} · {selected.capturedAt?new Date(selected.capturedAt).toLocaleString('zh-CN'):''}</p>
        </>:<div className="map-intro"><span className="map-eyebrow">SCREEN FLOW</span><h2>把整个应用<br/>放在一起看。</h2><p>已采集卡片展示真实 Flutter 页面截图。选中页面，查看截图、相邻关系或实时预览。</p><ol><li>拖动画布，滚轮缩放</li><li>筛选身份、场景或功能区域</li><li>点击页面，进入实时预览</li></ol><div className="map-scope"><b>本轮采集范围</b><p>{map.scope}</p><p>{map.discovery ? '已验证流程显示实际录到连线的页面。切换到「未连入流程」可查看只有截图的页面和待采集候选。' : '截图不代表流程验证。画布只显示已发现的页面和已记录的关系。'}</p>{Boolean(map.diagnostics?.length)&&<details><summary>采集提示 · {map.diagnostics?.length} 条</summary><ul>{map.diagnostics?.slice(0,10).map((message,index)=><li key={index}>{message}</li>)}</ul></details>}</div></div>}
      </aside>
    </div>
    <footer className={`map-status ${stale||map.runtimeErrors?.length?'is-stale':''}`}><span>{map.runtimeErrors?.length ? `采集运行异常 ${map.runtimeErrors.length} 项，请查看采集报告 · ` : ''}{stale?'● 源码已变化，请重新采集':source?'● 采集后源码未变（不替代构建验证）':'● 源码新鲜度未核验'} · {new Date(map.capturedAt).toLocaleString('zh-CN')}</span><span>{map.viewport.width} × {map.viewport.height} · {map.theme}{map.sourceFingerprint&&` · 指纹 ${map.sourceFingerprint.slice(0,10)}`}</span></footer>
  </main>;
}

export default function AppMap({adapter}: {adapter: AtlasViewerAdapter}) {
  const [map,setMap]=useState<AppMapManifest|null>(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt] = useState<CaptureAttempt|null>(null);
  const revision = useRef(0);
  const load = useCallback(() => {
    const request = ++revision.current;
    setError('');
    void Promise.resolve().then(() => adapter.loadLatestAttempt?.() ?? null).then(value => {
      if (request === revision.current) setAttempt(value);
    }).catch(() => { if (request === revision.current) setAttempt(null); });
    void Promise.resolve().then(() => adapter.loadManifest()).then(value => {
      if(value.schemaVersion!==1||!Array.isArray(value.screens)||!Array.isArray(value.edges))throw Error('采集文件格式不正确');
      if (request === revision.current) setMap(value);
    }).catch(error => { if (request === revision.current) setError(String(error.message)); });
  },[adapter]);
  useEffect(() => {
    load();
    return () => { revision.current++; };
  },[load]);
  if(!map||error)return <main className="map-empty"><h1>应用地图</h1><p>{error||'正在加载真实页面…'}</p><AttemptNotice attempt={attempt} hasMap={false}/>{error&&<><code>{adapter.captureHint??'请运行项目的 Atlas 采集适配器'}</code><p><button onClick={load}>重新加载</button></p></>}</main>;
  return <ReactFlowProvider><MapCanvas map={map} attempt={attempt?.captureId===map.captureId?null:attempt} refresh={load} adapter={adapter}/></ReactFlowProvider>;
}
