import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {include: ['tests/role-state.test.ts'], environment: 'node'},
});
