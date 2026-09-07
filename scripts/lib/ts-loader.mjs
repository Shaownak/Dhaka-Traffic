/**
 * Lets the scripts import the application's TypeScript source directly.
 *
 * Two things stand between raw Node and this codebase:
 *
 *   1. The source uses bundler-style extensionless imports ('../data/network'),
 *      which Node will not resolve on its own.
 *   2. Node requires `with { type: 'json' }` on JSON imports; Vite does not, so
 *      the source does not carry it.
 *
 * Both are properties of the bundler contract, not of the code, so the fix
 * belongs in the loader rather than in the application. Node 22.6+ strips the
 * types itself.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const HOOK = `
  export async function resolve(spec, ctx, next) {
    // JSON needs an explicit attribute in Node; the bundler infers it. The
    // attribute has to be set on the RESULT — passing it forward in the context
    // does not reach the load step that validates it.
    if (spec.endsWith('.json')) {
      const resolved = await next(spec, ctx);
      return { ...resolved, importAttributes: { type: 'json' } };
    }
    try {
      return await next(spec, ctx);
    } catch (err) {
      if (err && err.code === 'ERR_MODULE_NOT_FOUND' && !/\\.[a-z]+$/.test(spec)) {
        return next(spec + '.ts', ctx);
      }
      throw err;
    }
  }
`;

let registered = false;

/** Idempotent: calling it twice in one process is harmless. */
export function registerTsLoader() {
  if (registered) return;
  register('data:text/javascript,' + encodeURIComponent(HOOK), pathToFileURL('./'));
  registered = true;
}
