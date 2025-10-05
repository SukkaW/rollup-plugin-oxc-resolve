import path from 'path';
import process from 'process';
import type { OutputOptions } from 'rollup';
import type { RollupBuild } from 'rollup';

interface OutputFile {
  code?: string,
  fileName: string,
  source?: string,
  map?: string
}

export async function getCode(bundle: RollupBuild, outputOptions?: OutputOptions, allFiles = false): Promise<string | OutputFile[]> {
  const { output } = await bundle.generate(outputOptions || { format: 'cjs', exports: 'auto' });

  if (allFiles) {
    return output.map(({ code, fileName, source, map }) => ({
      code,
      fileName,
      source,
      map
    }));
  }
  const [{ code }] = output;
  return code;
}

export async function getFiles(bundle: RollupBuild, outputOptions: OutputOptions): Promise<Array<{ fileName: string, content: string }>> {
  if (!outputOptions.dir && !outputOptions.file) { throw new Error('You must specify "output.file" or "output.dir" for the build.'); }

  const { output } = await bundle.generate({ format: 'cjs', exports: 'auto', ...outputOptions });

  return output.map(({ code, fileName, source }) => {
    const absPath = path.resolve(outputOptions.dir || path.dirname(outputOptions.file!), fileName);
    return {
      fileName: path.relative(process.cwd(), absPath).split(path.sep).join('/'),
      content: code || source!
    };
  });
}

export async function getImports(bundle: RollupBuild): Promise<string[]> {
  if ('imports' in bundle) {
    return bundle.imports;
  }
  const { output } = await bundle.generate({ format: 'es' });
  const [{ imports }] = output;
  return imports;
}

export async function getResolvedModules(bundle: RollupBuild): Promise<Record<string, any>> {
  const {
    output: [{ modules }]
  } = await bundle.generate({ format: 'es' });
  return modules;
}

// eslint-disable-next-line no-console -- test
export const onwarn = (warning: any) => console.warn(warning.toString());

export async function testBundle(t: any, bundle: RollupBuild, { inject = {}, options = {} } = {}): Promise<{ code: string, error?: any, module: { exports: any }, result?: any }> {
  const { output } = await bundle.generate({ format: 'cjs', exports: 'auto', ...options });
  const [{ code }] = output;
  const module = { exports: {} };
  // as of 1/2/2020 Github Actions + Windows has changed in a way that we must now escape backslashes
  const cwd = process.cwd().replaceAll('\\', '\\\\');
  const params = ['module', 'exports', 'require', 't', ...Object.keys(inject)].concat(
    `process.chdir('${cwd}'); let result;\n\n${code}\n\nreturn result;`
  );

  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval -- test
  const func = new Function(...params);
  let error;
  let result;

  try {
    result = func(module, module.exports, require, t, ...Object.values(inject));
  } catch (e) {
    error = e;
  }

  return { code, error, module, result };
}

export async function evaluateBundle(bundle: RollupBuild): Promise<any> {
  const { module } = await testBundle(null, bundle);
  return module.exports;
}
