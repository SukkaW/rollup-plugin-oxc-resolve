import { dirname, resolve } from 'node:path';
import process from 'node:process';

import type {
  Plugin as RollupPlugin,
  PluginContext as RollupPluginContext,
  NormalizedInputOptions as RollupNormalizedInputOptions,
  PartialResolvedId
} from 'rollup';

import { builtinModules as nodeBuiltinModules } from 'node:module';
import { version } from '../package.json';

import { ResolverFactory } from 'oxc-resolver';
import type { NapiResolveOptions, ResolveResult } from 'oxc-resolver';

const ES6_BROWSER_EMPTY = '\0node-resolve:empty.js';
const NODE_IMPORT_PREFIX = /^node:/;

/**
 * The `symlinks` option are ignored and the plugin will respect rollup's option
 */
export interface RollupOxcResolveOptions extends Exclude<NapiResolveOptions, 'symlinks'> {
  rootDir?: string,
  preferBuiltins?: boolean | ((id: string) => boolean),
  resolveOnly?: Array<string | RegExp> | ((id: string) => boolean)
}

export const defaultOptions: RollupOxcResolveOptions = {
  // It's important that .mjs is listed before .js so that Rollup will interpret npm modules
  // which deploy both ESM .mjs and CommonJS .js files as ESM.
  extensions: ['.mjs', '.cjs', '.js', '.json', '.node', '.wasm'],
  // Prefer ESM in Dual ESM/CJS packages.
  conditionNames: ['default', 'module', 'import', 'require'],
  mainFields: ['browser', 'module', 'main'],
  exportsFields: ['exports'],
  mainFiles: ['index'],
  extensionAlias: {
    '.js': ['.tsx', '.mts', '.ts', '.cts', '.jsx', '.mjs', '.js', '.cjs'],
    '.jsx': ['.tsx', '.jsx'],
    '.mjs': ['.mts', '.mjs'],
    '.cjs': ['.cts', '.cjs']
  }
};

export function oxcResolve(options: RollupOxcResolveOptions = {}): RollupPlugin {
  options = {
    ...defaultOptions,
    ...options
  };

  const {
    mainFields = [],
    builtinModules: useBuiltinModules = true,
    conditionNames = [],
    rootDir = process.cwd()
  } = options;

  if (!conditionNames.includes('development') && !conditionNames.includes('production')) {
    conditionNames.push(process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? 'development' : 'production');
  }

  const useBrowserOverrides = mainFields.includes('browser');
  const isPreferBuiltinsSet = Object.hasOwn(options, 'preferBuiltins');
  const preferBuiltins = isPreferBuiltinsSet ? options.preferBuiltins : true;

  if (useBrowserOverrides && !conditionNames.includes('browser')) {
    conditionNames.push('browser');
  }

  let rollupOptions: RollupNormalizedInputOptions;

  let resolverFactory: ResolverFactory;

  const resolveOnly =
    typeof options.resolveOnly === 'function'
      ? options.resolveOnly
      : allowPatterns(options.resolveOnly);

  const resolveLikeNode = async (
    context: RollupPluginContext,
    importee: string,
    importer: string | undefined
  ): Promise<PartialResolvedId | null | false> => {
    // strip query params from import
    const [importPath, params] = importee.split('?');
    const importSuffix = params ? `?${params}` : '';
    importee = importPath;

    const baseDir = importer ? dirname(importer) : rootDir;

    const parts = importee.split(/[/\\]/);
    let id = parts.shift()!;
    let isRelativeImport = false;

    if (id[0] === '@' && parts.length > 0) {
      // scoped packages
      id += `/${parts.shift()}`;
    } else if (id[0] === '.') {
      // an import relative to the parent dir of the importer
      id = resolve(baseDir, importee);
      isRelativeImport = true;
    }

    // if it's not a relative import, and it's not requested, reject it.
    if (!isRelativeImport && !resolveOnly(id)) {
      if (normalizeInput(rollupOptions.input).includes(importee)) {
        return null;
      }
      return false;
    }

    const importSpecifierList = [importee];

    if (importer === undefined && importee[0] && !/^\.{0,2}\//.test(importee[0])) {
      // For module graph roots (i.e. when importer is undefined), we
      // need to handle 'path fragments` like `foo/bar` that are commonly
      // found in rollup config files. If importee doesn't look like a
      // relative or absolute path, we make it relative and attempt to
      // resolve it.
      importSpecifierList.push(`./${importee}`);
    }

    const importeeIsBuiltin = useBuiltinModules && nodeBuiltinModules.includes(importee.replace(NODE_IMPORT_PREFIX, ''));
    const preferImporteeIsBuiltin =
      typeof preferBuiltins === 'function' ? preferBuiltins(importee) : preferBuiltins;

    if (importeeIsBuiltin && preferImporteeIsBuiltin) {
      return {
        id,
        external: true,
        moduleSideEffects: false
      };
    }

    let resolved: ResolveResult | null = null;

    for (const importSpecifer of importSpecifierList) {
      // eslint-disable-next-line no-await-in-loop -- run in sequence
      resolved = await resolverFactory.async(
        importer == null ? baseDir : dirname(importer),
        importSpecifer
      );

      context.debug(`resolving '${importSpecifer}' from '${importer ?? '<root>'}', ${JSON.stringify(resolved)}`);

      if (!resolved.path) {
        continue;
      }
    }

    if (!resolved) {
      return null;
    }

    if (resolved.error) {
      // Usually, previous built-in handling should already cover builtin modules
      // But in case oxc-resolver did throw this, let's handle it as well
      if (resolved.error.startsWith('Builtin module')) {
        return {
          id,
          external: true,
          moduleSideEffects: false
        };
      }

      context.warn(resolved.error);
    }

    if (importeeIsBuiltin && preferImporteeIsBuiltin) {
      if (!isPreferBuiltinsSet && resolved.path !== importee) {
        context.warn({
          message:
            `preferring built-in module '${importee}' over local alternative at '${resolved.path}', pass 'preferBuiltins: false' to disable this behavior or 'preferBuiltins: true' to disable this warning.`
            + 'or passing a function to \'preferBuiltins\' to provide more fine-grained control over which built-in modules to prefer.',
          pluginCode: 'PREFER_BUILTINS'
        });
      }
      return false;
    }

    return {
      id: resolved.path + importSuffix
    };
  };

  return {
    name: 'oxc-resolve',

    version,

    buildStart(buildOptions) {
      rollupOptions = buildOptions;

      // Remove builtinModules from options as ResolverFactory expects a boolean for builtinModules
      resolverFactory = new ResolverFactory({
        ...options,
        builtinModules: useBuiltinModules,
        conditionNames,
        symlinks: buildOptions.preserveSymlinks
      });
    },

    // generateBundle() {
    //   readCachedFile.clear();
    //   isFileCached.clear();
    //   isDirCached.clear();
    // },

    resolveId: {
      order: 'post',
      async handler(importee, importer, resolveOptions) {
        if (importee === ES6_BROWSER_EMPTY) {
          return importee;
        }
        // ignore IDs with null character, these belong to other plugins
        if (!importee) return null;
        if (importee.includes('\0')) return null;

        const { custom = {} } = resolveOptions;
        const { 'node-resolve': { resolved: alreadyResolved } = {} } = custom;
        if (alreadyResolved) {
          return alreadyResolved;
        }

        if (importer?.includes('\0')) {
          importer = undefined;
        }

        const resolved = await resolveLikeNode(this, importee, importer);
        if (resolved) {
          // This way, plugins may attach additional meta information to the
          // resolved id or make it external. We do not skip node-resolve here
          // because another plugin might again use `this.resolve` in its
          // `resolveId` hook, in which case we want to add the correct
          // `moduleSideEffects` information.
          const resolvedResolved = await this.resolve(resolved.id, importer, {
            ...resolveOptions,
            skipSelf: false,
            custom: { ...custom, 'node-resolve': { ...custom['node-resolve'], resolved, importee } }
          });
          if (resolvedResolved) {
            // Handle plugins that manually make the result external
            if (resolvedResolved.external) {
              return false;
            }
            // Allow other plugins to take over resolution. Rollup core will not
            // change the id if it corresponds to an existing file
            if (resolvedResolved.id !== resolved.id) {
              return resolvedResolved;
            }
            // Pass on meta information added by other plugins
            return { ...resolved, meta: resolvedResolved.meta };
          }
        }
        return resolved;
      }
    },

    load(importee) {
      if (importee === ES6_BROWSER_EMPTY) {
        return 'export default {};';
      }
      return null;
    }
  };
}

// creates a function from the patterns to test if a particular module should be bundled.
function allowPatterns(patterns: Array<string | RegExp> = []) {
  const regexPatterns = patterns.map((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern;
    }
    const normalized = pattern.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
    return new RegExp(`^${normalized}$`);
  });
  return (id: string) => !regexPatterns.length || regexPatterns.some((pattern) => pattern.test(id));
}

function normalizeInput(input: RollupNormalizedInputOptions['input']) {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === 'object') {
    return Object.values(input);
  }

  // otherwise it's a string
  return [input];
}

export function defineRollupOxcResolveOptions(options: RollupOxcResolveOptions): RollupOxcResolveOptions {
  return options;
}
