import { dirname, resolve } from 'path';

import type {
  Plugin as RollupPlugin,
  PluginContext as RollupPluginContext,
  NormalizedInputOptions as RollupNormalizedInputOptions,
  CustomPluginOptions as RollupCustomPluginOptions
} from 'rollup';

import { builtinModules as nodeBuiltinModules } from 'module';
import { version } from '../package.json';

import { ResolverFactory } from 'oxc-resolver';
import type { NapiResolveOptions, ResolveResult } from 'oxc-resolver';

const ES6_BROWSER_EMPTY = '\0node-resolve:empty.js';
const NODE_IMPORT_PREFIX = /^node:/;

export interface OxcResolveOptions extends Exclude<NapiResolveOptions, 'preserveSymlinks'> {
  preferBuiltins?: boolean | ((id: string) => boolean),
  resolveOnly?: Array<string | RegExp> | ((id: string) => boolean)
}

export const defaultOptions: OxcResolveOptions = {
  extensions: ['.mjs', '.cjs', '.js', '.json', '.node'],
  conditionNames: ['default', 'module', 'import', 'require'],
  mainFields: ['browser', 'module', 'main'],
  exportsFields: ['exports'],
  mainFiles: ['index']
};

export function oxcResolve(options: OxcResolveOptions = {}): RollupPlugin {
  options = {
    ...defaultOptions,
    ...options
  };

  const {
    extensions = [],
    mainFields = [],
    builtinModules: useBuiltinModules,
    conditionNames = []
  } = options;

  if (!conditionNames.includes('development') && !conditionNames.includes('production')) {
    conditionNames.push(process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? 'development' : 'production');
  }

  const useBrowserOverrides = mainFields.includes('browser');
  const isPreferBuiltinsSet = Object.hasOwn(options, 'preferBuiltins');
  const preferBuiltins = isPreferBuiltinsSet ? options.preferBuiltins : true;

  let rollupOptions: RollupNormalizedInputOptions;

  let resolverFactory: ResolverFactory;

  const resolveOnly
    = typeof options.resolveOnly === 'function'
      ? options.resolveOnly
      : allowPatterns(options.resolveOnly);

  const resolveLikeNode = async (
    context: RollupPluginContext,
    importee: string,
    importer: string | undefined,
    custom?: RollupCustomPluginOptions | null
  ) => {
    // strip query params from import
    const [importPath, params] = importee.split('?');
    const importSuffix = params ? `?${params}` : '';
    importee = importPath;

    const baseDir = importer ? dirname(importer) : process.cwd();

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

    if (importer === undefined && !/^\.{0,2}\//.test(importee[0])) {
      // For module graph roots (i.e. when importer is undefined), we
      // need to handle 'path fragments` like `foo/bar` that are commonly
      // found in rollup config files. If importee doesn't look like a
      // relative or absolute path, we make it relative and attempt to
      // resolve it.
      importSpecifierList.push(`./${importee}`);
    }

    // TypeScript files may import '.mjs' or '.cjs' to refer to either '.mts' or '.cts'.
    // They may also import .js to refer to either .ts or .tsx, and .jsx to refer to .tsx.
    if (importer && /\.(?:ts|[cm]ts|tsx)$/.test(importer)) {
      for (const [importeeExt, resolvedExt] of [
        ['.js', '.ts'],
        ['.js', '.tsx'],
        ['.jsx', '.tsx'],
        ['.mjs', '.mts'],
        ['.cjs', '.cts']
      ]) {
        if (importee.endsWith(importeeExt) && extensions.includes(resolvedExt)) {
          importSpecifierList.push(importee.slice(0, -importeeExt.length) + resolvedExt);
        }
      }
    }

    const isRequire = custom?.['node-resolve']?.isRequire;
    const exportConditions = isRequire ? conditionNames : conditionNames;
    if (useBrowserOverrides && !exportConditions.includes('browser')) { exportConditions.push('browser'); }

    const importeeIsBuiltin = useBuiltinModules && nodeBuiltinModules.includes(importee.replace(NODE_IMPORT_PREFIX, ''));
    const preferImporteeIsBuiltin
      = typeof preferBuiltins === 'function' ? preferBuiltins(importee) : preferBuiltins;

    if (importeeIsBuiltin && preferImporteeIsBuiltin) {
      return null;
    }

    let resolved: ResolveResult | null = null;

    for (const importSpecifer of importSpecifierList) {
      // eslint-disable-next-line no-await-in-loop -- run in sequence
      resolved = await resolverFactory.async(
        importer ?? process.cwd(),
        importSpecifer
      );

      if (!resolved.path) {
        continue;
      }
    }

    if (resolved?.error) {
      context.warn(resolved.error);
    }

    if (!resolved) {
      return null;
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

        const resolved = await resolveLikeNode(this, importee, importer, custom);
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

export default oxcResolve;
