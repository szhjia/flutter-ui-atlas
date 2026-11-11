const loopbackHostnames = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * 回环边界的单一策略出口：目标主机非回环且未显式放行时，抛调用方提供的中文错误。
 * allowRemote 由数据配置（yaml/json）的 allowRemoteUrls 提供；.mjs 适配器属可信本地代码，不经此校验。
 */
export function assertLoopback(url, {allowRemote = false, message}) {
  if (allowRemote || loopbackHostnames.includes(url.hostname)) return;
  throw Error(message);
}
