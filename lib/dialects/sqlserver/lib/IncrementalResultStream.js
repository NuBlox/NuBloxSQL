'use strict';

var TokenStream = require('./TokenStream');
var ResultStream = require('./ResultStream');
var TOKENS = TokenStream.TOKENS;

function isIncomplete(error) {
  return error instanceof RangeError && /^Incomplete SQL Server /.test(error.message || '');
}

function IncrementalResultStream() {
  this.buffer = Buffer.alloc(0);
  this.columns = Object.freeze([]);
  this.errors = [];
  this.info = [];
  this.envChanges = [];
  this.order = Object.freeze([]);
  this.done = null;
  this.returnStatus = null;
  this.rowCount = 0n;
  this.rowsSeen = 0n;
  this.ended = false;
}

IncrementalResultStream.prototype.push = function push(chunk, endOfMessage) {
  if (this.ended) throw new Error('SQL Server incremental result stream is already complete');
  if (chunk && chunk.length) {
    var bytes = Buffer.from(chunk);
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, bytes]) : bytes;
  }

  var cursor = 0;
  var rows = [];
  while (cursor < this.buffer.length) {
    var token = this.buffer[cursor];
    var parsed;
    try {
      if (token === TOKENS.COLMETADATA) {
        parsed = ResultStream.parseColumnMetadata(this.buffer, cursor);
        this.columns = parsed.columns;
        cursor = parsed.offset;
        continue;
      }
      if (token === TOKENS.ROW || token === TOKENS.NBCROW) {
        parsed = ResultStream.parseRow(this.buffer, cursor, this.columns, token === TOKENS.NBCROW);
        rows.push(parsed.row);
        this.rowsSeen += 1n;
        cursor = parsed.offset;
        continue;
      }
      if (token === TOKENS.ORDER) {
        parsed = TokenStream.parseOrder(this.buffer, cursor);
        this.order = parsed.columns;
        cursor += parsed.bytesConsumed;
        continue;
      }
      if (token === TOKENS.ERROR || token === TOKENS.INFO) {
        parsed = TokenStream.parseMessage(this.buffer, cursor, token === TOKENS.ERROR ? 'error' : 'info');
        if (parsed.type === 'error') this.errors.push(parsed);
        else this.info.push(parsed);
        cursor += parsed.bytesConsumed;
        continue;
      }
      if (token === TOKENS.ENVCHANGE) {
        parsed = TokenStream.parseEnvChange(this.buffer, cursor);
        this.envChanges.push(parsed);
        cursor += parsed.bytesConsumed;
        continue;
      }
      if (token === TOKENS.RETURNSTATUS) {
        parsed = TokenStream.parseReturnStatus(this.buffer, cursor);
        this.returnStatus = parsed.value;
        cursor += parsed.bytesConsumed;
        continue;
      }
      if (token === TOKENS.DONE || token === TOKENS.DONEPROC || token === TOKENS.DONEINPROC) {
        parsed = TokenStream.parseDone(this.buffer, cursor);
        this.done = parsed;
        if (parsed.hasRowCount) this.rowCount = parsed.rowCount;
        cursor += parsed.bytesConsumed;
        continue;
      }
      throw new RangeError('Unsupported SQL Server result token 0x' + token.toString(16).padStart(2, '0'));
    } catch (error) {
      if (isIncomplete(error)) break;
      throw error;
    }
  }

  if (cursor) this.buffer = Buffer.from(this.buffer.subarray(cursor));
  if (endOfMessage) {
    if (this.buffer.length) throw new RangeError('Incomplete SQL Server result token at end of TDS message');
    this.ended = true;
    if (!this.done || !this.done.hasRowCount) this.rowCount = this.rowsSeen;
  }
  return Object.freeze(rows);
};

IncrementalResultStream.prototype.result = function result() {
  return Object.freeze({
    columns: this.columns,
    rows: Object.freeze([]),
    errors: Object.freeze(this.errors.slice()),
    info: Object.freeze(this.info.slice()),
    envChanges: Object.freeze(this.envChanges.slice()),
    order: this.order,
    rowCount: this.rowCount,
    done: this.done,
    returnStatus: this.returnStatus,
    success: this.errors.length === 0 && (!this.done || !this.done.error)
  });
};

exports.IncrementalResultStream = IncrementalResultStream;
