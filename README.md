# rollup-plugin-oxc-resolve

A Rollup plugin which locates modules using the [oxc-resolver](https://github.com/oxc-project/oxc-resolver), for using third party modules in `node_modules`.

> This plugin is highly experimental and is under heavy development (`0.0.x` versions so far). Feel free to install and give this plugin a shot, but refrain from using it in production.

## Installation

```bash
npm install --save-dev rollup-plugin-oxc-resolve
yarn add -D rollup-plugin-oxc-resolve
pnpm add -D rollup-plugin-oxc-resolve
```

## Usage

```js
// rollup.config.js
import { oxcResolve, defineRollupOxcResolveOptions } from 'rollup-plugin-oxc-resolve';
import { swc, defineRollupSwcOption } from 'rollup-plugin-swc3';

export default {
  input: 'src/index.js',
  output: {
    dir: 'output',
    format: 'cjs'
  },
  plugins: [
    oxcResolve(defineRollupOxcResolveOptions({
      // `defineRollupOxcResolveOptions` helps utilizing your IDE's type hinting and auto-completion.
    })),
    // Might wanna use my `rollup-plugin-swc3` to speed up your rollup build as well
    swc(defineRollupSwcOption({
      // ... There goes the plugin's configuration
    })),
  ]
};
```

---

**rollup-plugin-oxc-resolve** © [Sukka](https://github.com/SukkaW), Released under the [MIT](./LICENSE) License.<br>

Authored and maintained by Sukka with help from contributors ([list](https://github.com/SukkaW/rollup-plugin-oxc-resolve/graphs/contributors)).

> [Personal Website](https://skk.moe) · [Blog](https://blog.skk.moe) · GitHub [@SukkaW](https://github.com/SukkaW) · Telegram Channel [@SukkaChannel](https://t.me/SukkaChannel) · Mastodon [@sukka@acg.mn](https://acg.mn/@sukka) · Twitter [@isukkaw](https://twitter.com/isukkaw) · Keybase [@sukka](https://keybase.io/sukka)

<p align="center">
  <a href="https://github.com/sponsors/SukkaW/">
    <img src="https://sponsor.cdn.skk.moe/sponsors.svg"/>
  </a>
</p>
