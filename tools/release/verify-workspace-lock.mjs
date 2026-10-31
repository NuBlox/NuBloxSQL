#!/usr/bin/env node
/** Verify exact workspace build dependency graph before release qualification. */
import {readFileSync} from 'node:fs';
import {inspectWorkspaceLock} from './workspace-lock-core.mjs';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const report=inspectWorkspaceLock(
  read('../../package.json'),
  read('../../packages/driver/package.json'),
  read('../../package-lock.json')
);
console.log(JSON.stringify(report,null,2));
