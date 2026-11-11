import {existsSync} from 'node:fs';
import {acquireOutputLock} from '../../packages/capture/lock.mjs';

const [output, resumeFile] = process.argv.slice(2);
let release;
process.on('message', async message => {
  if (message !== 'release') return;
  try {
    await release?.();
    process.disconnect();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    process.disconnect();
  }
});
try {
  release = await acquireOutputLock(output, {
    warn: () => {
      process.send({event: 'warning'});
      if (!resumeFile) return;
      const deadline = Date.now() + 5_000;
      while (!existsSync(resumeFile)) {
        if (Date.now() >= deadline) throw Error('测试屏障未解除');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
  });
  process.send({event: 'acquired'});
} catch (error) {
  process.send({event: 'denied', message: error.message});
  process.disconnect();
}
