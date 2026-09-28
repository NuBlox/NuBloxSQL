import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

import mysql, {
  PromiseConnection,
  PromisePool,
  Types,
  createConnection,
  createPool,
  createPoolCluster,
  createQuery,
  escape,
  escapeId,
  format,
  param,
  raw
} from '@nublox/mysql';
import promiseMysql, {
  Types as PromiseTypes,
  createConnection as createPromiseConnection,
  createPool as createPromisePool,
  escape as promiseEscape,
  escapeId as promiseEscapeId,
  format as promiseFormat,
  param as promiseParam,
  raw as promiseRaw
} from '@nublox/mysql/promise';
import createOpenTelemetryAdapter, {
  createOpenTelemetryAdapter as namedCreateOpenTelemetryAdapter
} from '@nublox/mysql/otel';

const require = createRequire(import.meta.url);
const callbackCjs = require('@nublox/mysql');
const promiseCjs = require('@nublox/mysql/promise');
const otelCjs = require('@nublox/mysql/otel');

assert.equal(mysql, callbackCjs);
assert.equal(promiseMysql, promiseCjs);
assert.equal(createOpenTelemetryAdapter, otelCjs);
assert.equal(namedCreateOpenTelemetryAdapter, otelCjs.createOpenTelemetryAdapter);

assert.equal(createConnection, callbackCjs.createConnection);
assert.equal(createPool, callbackCjs.createPool);
assert.equal(createPoolCluster, callbackCjs.createPoolCluster);
assert.equal(createQuery, callbackCjs.createQuery);
assert.equal(escape, callbackCjs.escape);
assert.equal(escapeId, callbackCjs.escapeId);
assert.equal(format, callbackCjs.format);
assert.equal(param, callbackCjs.param);
assert.equal(raw, callbackCjs.raw);
assert.equal(Types, callbackCjs.Types);
assert.equal(PromiseConnection, callbackCjs.PromiseConnection);
assert.equal(PromisePool, callbackCjs.PromisePool);

assert.equal(createPromiseConnection, promiseCjs.createConnection);
assert.equal(createPromisePool, promiseCjs.createPool);
assert.equal(promiseEscape, promiseCjs.escape);
assert.equal(promiseEscapeId, promiseCjs.escapeId);
assert.equal(promiseFormat, promiseCjs.format);
assert.equal(promiseParam, promiseCjs.param);
assert.equal(promiseRaw, promiseCjs.raw);
assert.equal(PromiseTypes, promiseCjs.Types);

assert.equal(format('SELECT ? AS value', [42]), 'SELECT 42 AS value');
assert.equal(promiseFormat('SELECT ? AS value', [42]), 'SELECT 42 AS value');
assert.equal(param.uint32(4294967295).unsigned, true);
assert.equal(promiseParam.int8(-1).type, Types.TINY);
