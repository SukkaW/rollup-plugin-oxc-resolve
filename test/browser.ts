import { join } from 'path';

import { it } from 'mocha';

import { rollup } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';

import { testBundle } from './test-utils.js';

import { oxcResolve } from '../dist/cjs/index.js';
import { expect } from 'expect';

process.chdir(join(__dirname, 'fixtures'));

describe('browser field', () => {
  it('disregards top-level browser field', async (t) => {
    const bundle = await rollup({
      input: 'browser.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [oxcResolve()]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('node');
  });

  it('allows use of the top-level browser field', async (t) => {
    const bundle = await rollup({
      input: 'browser.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('browser');
  });

  it('disregards object browser field', async (t) => {
    const bundle = await rollup({
      input: 'browser-object.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [oxcResolve()]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports.env).toBe('node');
    expect(module.exports.dep).toBe('node-dep');
    expect(module.exports.test).toBe(42);
  });

  it('allows use of the object browser field', async (t) => {
    const bundle = await rollup({
      input: 'browser-object.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports.env).toBe('browser');
    expect(module.exports.dep).toBe('browser-dep');
    expect(module.exports.test).toBe(43);
  });

  it('allows use of object browser field, resolving `main`', async (t) => {
    const bundle = await rollup({
      input: 'browser-object-main.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports.env).toBe('browser');
    expect(module.exports.dep).toBe('browser-dep');
    expect(module.exports.test).toBe(43);
  });

  it('options.browser = true still works', async (t) => {
    const bundle = await rollup({
      input: 'browser-object-main.js',
      plugins: [
        oxcResolve({
          browser: true
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports.env).toBe('browser');
    expect(module.exports.dep).toBe('browser-dep');
    expect(module.exports.test).toBe(43);
  });

  it('allows use of object browser field, resolving implicit `main`', async (t) => {
    const bundle = await rollup({
      input: 'browser-object-implicit.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports.env).toBe('browser');
  });

  it('allows use of object browser field, resolving replaced builtins', async (t) => {
    const bundle = await rollup({
      input: 'browser-object-builtin.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('browser-fs');
  });

  it('allows use of object browser field, resolving nested directories', async (t) => {
    const bundle = await rollup({
      input: 'browser-object-nested.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports.env).toBe('browser');
    expect(module.exports.dep).toBe('browser-dep');
    expect(module.exports.test).toBe(43);
  });

  it('respects local browser field for external dependencies', async (t) => {
    const bundle = await rollup({
      input: 'browser-local.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('component-type');
  });

  it('respects local browser field for internal dependencies', async (t) => {
    const bundle = await rollup({
      input: 'browser-local-relative.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('component-type');
  });

  it('does not apply local browser field for matching imports in nested paths', async () => {
    try {
      await rollup({
        input: 'nested/browser-local-relative.js',
        onwarn() { throw new Error('No warnings were expected'); },
        plugins: [
          oxcResolve({
            mainFields: ['browser', 'main']
          })
        ]
      });
    } catch (e) {
      if (typeof e !== 'object' || !e || !('code' in e)) {
        throw new TypeError('expecting error with code property');
      }
      expect(e.code).toBe('UNRESOLVED_IMPORT');
      return;
    }
    throw new Error('expecting error');
  });

  it('allows use of object browser field, resolving to nested node_modules', async (t) => {
    const bundle = await rollup({
      input: 'browser-entry-points-to-node-module.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          main: true,
          browser: true
        })
      ]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('component-type');
  });

  it('supports `false` in browser field', async (t) => {
    const bundle = await rollup({
      input: 'browser-false.js',
      onwarn() { throw new Error('No warnings were expected'); },
      plugins: [
        oxcResolve({
          mainFields: ['browser', 'main']
        })
      ]
    });
    await testBundle(t, bundle);
  });

  it('pkg.browser with mapping to prevent bundle by specifying a value of false', async (t) => {
    const bundle = await rollup({
      input: 'browser-object-with-false.js',
      plugins: [oxcResolve({ browser: true }), commonjs()]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('ok');
  });

  it('exports.browser can be mapped via pkg.browser', async (t) => {
    const bundle = await rollup({
      input: 'browser-exports-browser-browser.js',
      plugins: [oxcResolve({ browser: true }), commonjs()]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('browser');
  });

  it('browser field does not take precedence over export map result', async (t) => {
    const bundle = await rollup({
      input: 'browser-exports-browser.js',
      plugins: [oxcResolve({ browser: true }), commonjs()]
    });
    const { module } = await testBundle(t, bundle);

    expect(module.exports).toBe('require');
  });
});
