#!/usr/bin/env node
import {inspectDatabase, InspectionError} from '@nubloxsql/driver';
import {writeFile, link, unlink} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';

const HELP = 'Usage: nublox shell inspect --profile ALIAS --format json --output PATH';

async function main(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP + '\n');
    return;
  }
  if (args[0] !== 'shell' || args[1] !== 'inspect') {
    throw new InspectionError('INVALID_INPUT', 'Unsupported Shell command.');
  }
  const flags = new Map<string, string>();
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key || !value || !['--profile','--format','--output'].includes(key) || flags.has(key)) {
      throw new InspectionError('INVALID_INPUT', 'Invalid Shell inspection options.');
    }
    flags.set(key, value);
  }
  const alias = flags.get('--profile');
  const destination = flags.get('--output');
  if (!alias || !destination || flags.get('--format') !== 'json' || alias !== process.env.NUBLOXSQL_PROFILE_ALIAS) {
    throw new InspectionError('INVALID_INPUT', 'An authorised profile alias, JSON format and output path are required.');
  }
  const password = process.env.NUBLOXSQL_PG_PASSWORD;
  if (!password) throw new InspectionError('INVALID_INPUT', 'The local profile credential is unavailable.');
  const security = process.env.NUBLOXSQL_PG_SECURITY;
  if (security !== 'isolated-local' && security !== 'verified-tls') {
    throw new InspectionError('TLS_UNVERIFIED', 'An explicit secure transport policy is required.');
  }
  const profile = {
    alias, engineId: 'postgresql' as const,
    host: process.env.NUBLOXSQL_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.NUBLOXSQL_PG_PORT ?? '5432'),
    user: process.env.NUBLOXSQL_PG_USER ?? '',
    database: process.env.NUBLOXSQL_PG_DATABASE ?? '',
    password,
    security
  };
  const inventory = await inspectDatabase(profile);
  const temporary = join(dirname(destination), '.nubloxsql-' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(inventory, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    // link is an atomic no-clobber create; do not overwrite existing work products.
    await link(temporary, destination);
  } catch {
    throw new InspectionError('OUTPUT_FAILED', 'The inventory file could not be written safely.');
  } finally {
    try { await unlink(temporary); } catch { /* Already absent */ }
  }
  process.stdout.write('Inventory written.\n');
}

main(process.argv.slice(2)).catch(error => {
  const safe = error instanceof InspectionError ? error :
    new InspectionError('DISCOVERY_FAILED', 'The database inspection failed.');
  process.stderr.write(safe.code + ': ' + safe.message + '\n');
  process.exitCode = 1;
});
