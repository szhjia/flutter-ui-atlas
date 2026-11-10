import {memo} from 'react';
import {BaseEdge,type EdgeProps} from '@xyflow/react';
import type {Point} from './types';
function EdgePath({id,data,style,markerEnd}:EdgeProps){const points=data?.points as Point[]|undefined;if(!points?.length)return null;return <BaseEdge id={id} path={points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')} style={style} markerEnd={markerEnd}/>;}

export const AtlasEdge=memo(EdgePath,(a,b)=>a.id===b.id&&a.data?.points===b.data?.points&&a.markerEnd===b.markerEnd&&a.style?.stroke===b.style?.stroke&&a.style?.strokeWidth===b.style?.strokeWidth&&a.style?.strokeDasharray===b.style?.strokeDasharray);
