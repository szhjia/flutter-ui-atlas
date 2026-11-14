import type {AtlasViewerConfig} from '../packages/viewer/src/config';

export interface EntryConfigResult {
  config: AtlasViewerConfig | null;
  error: string | null;
}

/** 空标签时的默认配置（原 main.tsx 逻辑原样迁入）。 */
export const defaultEntryConfig: AtlasViewerConfig = {
  artifactPaths: ['/generated'],
  shell: {title: 'Flutter UI Atlas'},
  layoutKey: 'atlas-default:phone-393x852:v1',
  captureHint: 'atlas build --config <config-file>',
  preview: {routeMode: 'hash', localOnly: true}
};

function invalid(reason?: unknown): EntryConfigResult {
  const detail = reason instanceof Error ? ` (${reason.message})` : '';
  return {
    config: null,
    error: `Could not parse canvas configuration${detail}. Check the JSON in #atlas-config, correct it, and reload.`
  };
}

/** 三态解析：合法 → config；空 → 默认 config；非法 → config 为 null 且给出可行动诊断。 */
export function parseEntryConfig(text: string | null | undefined): EntryConfigResult {
  if (!text) return {config: defaultEntryConfig, error: null};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return invalid(error);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return invalid();
  return {config: parsed as AtlasViewerConfig, error: null};
}
