import {Readable} from 'node:stream';
import {fail} from './errors.js';
import type {RelationalCursor,RelationalRowStream} from '../models/relational.js';

/**
 * A demand-driven Node object-mode Readable backed by one native cursor.
 *
 * Readable.from() only advances the async iterator when downstream requests
 * data. Node's highWaterMark bounds the object-mode queue independently of
 * the cursor's bounded COM_STMT_FETCH batch. No query-wide row collection.
 *
 * The owning session must keep the native cursor scope alive until the
 * application's stream callback finishes, then destroy this stream before
 * completing the scope. Never return the stream from an unscoped query API.
 */
export function cursorRowStream(
  cursor:RelationalCursor,highWaterMark:number
):RelationalRowStream {
  if(!Number.isSafeInteger(highWaterMark)||highWaterMark<1||highWaterMark>32)
    throw fail('INVALID_INPUT','Row stream highWaterMark must be 1–32 rows');
  const stream=Readable.from(cursor,{
    objectMode:true,highWaterMark
  }) as RelationalRowStream;
  Object.defineProperties(stream,{
    columns:{value:cursor.columns,enumerable:true},
    columnKeys:{value:cursor.columnKeys,enumerable:true}
  });
  return stream;
}
