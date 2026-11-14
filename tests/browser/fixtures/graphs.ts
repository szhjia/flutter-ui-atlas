import type {AppMapManifest} from '../../../packages/viewer/src/model';
export function graph(count: number): AppMapManifest {
  return {
    schemaVersion: 1,
    captureId: 'fixture-1',
    capturedAt: '2026-11-09T00:00:00Z',
    sourceFingerprint: 'fixture',
    viewport: {width: 393, height: 852},
    theme: '默认',
    scenarioId: 'fixture',
    seedVersion: '1',
    scope: '确定性画布验收',
    screens: Array.from({length: count}, (_, i) => ({
      id: `n${i}`,
      title: `页面 ${i}`,
      role: '示例',
      group: i === 1 ? '其他' : '验收',
      entry: '/',
      route: `/${i}`,
      state: '默认状态',
      status: 'captured',
      image:
        'data:image/svg+xml,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="393" height="852"><rect width="393" height="852" fill="#f1f5fa"/><text x="40" y="90" font-size="26" fill="#375e79">页面 ${i}</text></svg>`
        )
    })),
    edges: Array.from({length: count === 100 ? 150 : 7}, (_, i) => ({
      id: `e${i}`,
      source: `n${i % count}`,
      target: `n${(i + (i < count ? 1 : 11)) % count}`,
      action: i === 0 ? '点击课程卡片进入课程详情并查看完整课程内容' : '打开关联页面',
      sourceFile: 'fixture',
      status: 'observed'
    }))
  };
}
