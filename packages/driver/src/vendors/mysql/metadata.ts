import {field,eofStatus,assertSingleResult} from './protocol/results.js';
import type {MysqlColumn} from '../../core/contracts.js';
import {fail} from '../../core/errors.js';
import {MAX_COLUMNS} from '../../core/resources.js';

/** Consume each native ColumnDefinition41 packet and validate the EOF boundary. */
export async function readMetadata(getPacket:()=>Promise<Buffer>,count:number):Promise<MysqlColumn[]>{
  if(!Number.isSafeInteger(count)||count<0||count>MAX_COLUMNS)
    throw fail('RESOURCE_LIMIT','Invalid MySQL result column count');
  const columns:MysqlColumn[]=[];
  for(let i=0;i<count;i++)columns.push(field(await getPacket()));
  const end=eofStatus(await getPacket());
  assertSingleResult(end.status);
  return columns;
}
