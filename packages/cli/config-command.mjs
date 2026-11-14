import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createConfigStore} from './config-store.mjs';
import {createAuthenticationRunner} from './config-auth.mjs';
import {serveConfig} from './config-server.mjs';
import {ConfigError} from './config-values.mjs';

export async function configCommand(options, launchBrowser) {
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new ConfigError('配置页端口必须为 0 至 65535 的整数，0 表示自动分配。');
  const store = await createConfigStore({configFile: options.config});
  const authentication = createAuthenticationRunner({directory: store.directory, launchBrowser});
  const service = await serveConfig({store, authentication, port});
  console.log(`Flutter UI Atlas 配置页：${service.url}`);
  console.log('Ctrl+C 关闭服务；配置和凭据保存在当前 Flutter 工程的 .atlas 目录。');
  let stopping;
  const stop = () => {
    if (!stopping)
      stopping = service
        .close()
        .catch(() => {
          process.exitCode = 1;
        })
        .finally(() => {
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
        });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (!options['no-open']) {
    const command =
      process.platform === 'darwin'
        ? ['open', ['-a', 'Google Chrome', service.url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', service.url]]
          : ['google-chrome', [service.url]];
    try {
      await promisify(execFile)(command[0], command[1]);
    } catch {
      console.log('未能自动打开 Chrome，请手动打开上方配置页地址。');
    }
  }
  return service;
}
