/**
 * 画布布局与路由的命名常量：此前散落各文件的无名内联数字集中于此，有意差异以命名显式化。
 * 拖动用紧凑间距（DRAG_GAP），自动整理用宽松间距（ARRANGE_GAP）——这是刻意的设计差异。
 */
export const DEFAULT_NODE_SIZE = {width: 224, height: 528};
/** 拖动避让与冲突判定的紧凑间距（geometry 冲突、拖动候选）。 */
export const DRAG_GAP = {x: 96, y: 80};
/** 自动整理的宽松间距（nearestFree 默认、列距、行距）。 */
export const ARRANGE_GAP = {x: 160, y: 120};
/** 整理时相邻连通分量之间的垂直间隔。 */
export const COMPONENT_GAP = 240;
/** 路由障碍的扩展边距（连线与页面的安全距离）。 */
export const OBSTACLE_PADDING = 16;
/** A* 路由搜索的访问预算与转向代价。 */
export const EDGE_SEARCH_BUDGET = 4096;
export const EDGE_TURN_COST = 24;
/** 同端点平行连线的 sibling 偏移与出入桩长度。 */
export const EDGE_SIBLING_OFFSET = 18;
export const EDGE_STUB_LENGTH = 24;
/** quick 候选生成时纳入局部障碍的扫描边距。 */
export const LOCAL_SCAN_MARGIN = 32;
/** 拖动求解的访问预算、深度上限与最多联动页面数。 */
export const DRAG_SEARCH_BUDGET = 512;
export const DRAG_DEPTH_LIMIT = 128;
export const DRAG_MAX_DISPLACED = 12;
/** nearestFree 的环形搜索圈数与尝试预算。 */
export const NEAREST_RING_LIMIT = 40;
export const NEAREST_ATTEMPT_BUDGET = 2048;
/** 画布缩放范围（layout-storage 校验与 ReactFlow minZoom/maxZoom 共用）。 */
export const CANVAS_ZOOM = {min: 0.08, max: 1.8};
