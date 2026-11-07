import {fail} from '../../core/errors.js';
import {MAX_MATERIALIZED_RESULT_BYTES} from '../../core/resources.js';
import type {MysqlColumn} from '../../core/contracts.js';

/**
 * Bounded estimate for materialised MySQL QueryResult objects. The driver
 * retains positional rowValues AND named row objects, plus decoded strings
 * and binary buffer views. Their heap cost is not the wire-packet length.
 *
 * Exact V8 allocations vary with runtime/version/GC; these conservative
 * charges are an operational budget, not a measured heap size or an OOM
 * guarantee. The independent wire and row-count limits remain in force.
 */
// Initial calibration from repeated Node 22 CI runs on 2026-11-05:
// 64 all-NULL columns retained ~0.94 MiB per 250 rows against a 0.78 MiB
// estimate, and 8 numeric columns retained ~0.18–0.25 MiB against 0.15 MiB.
// Charge more for array slots and named row-object properties, without
// changing the independent 64 MiB cumulative cap. V8 allocation varies.
const RETAINED_ROW_BYTES=192;
const RETAINED_CELL_BYTES=64;

export class MysqlMaterializationBudget {
  private used=0;

  /** Diagnostic-only estimate; never interpret as actual V8 heap usage. */
  get estimatedBytes():number {return this.used;}

  private add(bytes:number):void {
    if(!Number.isSafeInteger(bytes)||bytes<0||
       bytes>MAX_MATERIALIZED_RESULT_BYTES-this.used)
      throw fail('RESOURCE_LIMIT','Combined MySQL materialized result exceeds memory budget');
    this.used+=bytes;
  }

  /** Column descriptors and collision-free key strings are retained per set. */
  columns(columns:readonly MysqlColumn[],keys:readonly string[]):void {
    let estimate=256*columns.length;
    for(const column of columns){
      estimate+=2*(column.name.length+
        (column.schema?.length??0)+(column.table?.length??0)+
        (column.originalName?.length??0)+(column.originalTable?.length??0));
    }
    for(const key of keys)estimate+=2*key.length;
    this.add(estimate);
  }

  /** Preflight fixed per-row and per-cell storage before decoding values. */
  beforeRow(columnCount:number):void {
    this.add(RETAINED_ROW_BYTES+RETAINED_CELL_BYTES*columnCount);
  }

  /** Decode-time string storage and retained binary views, without copying. */
  decoded(values:readonly unknown[]):void {
    let estimate=0;
    for(const value of values){
      if(typeof value==='string')estimate+=value.length*2;
      else if(Buffer.isBuffer(value))estimate+=64+value.byteLength;
      else if(typeof value==='bigint')estimate+=16;
    }
    this.add(estimate);
  }
}
