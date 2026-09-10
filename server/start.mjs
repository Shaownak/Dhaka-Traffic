#!/usr/bin/env node
/**
 * Boots the API. Registers the loader that lets Node import the TypeScript
 * source directly, then hands over to server/api.ts.
 *
 *   npm run api
 */
import { registerTsLoader } from '../scripts/lib/ts-loader.mjs';

registerTsLoader();

const { startServer } = await import('./api.ts');
startServer();
