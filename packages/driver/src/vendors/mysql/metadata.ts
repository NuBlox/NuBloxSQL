import {field,eofStatus,assertSingleResult} from './protocol/results.js';
import type {MysqlColumn} from '../../core/contracts.js';
import {fail} from '../../core/errors.js';
import {MAX_COLUMNS,MAX_PACKET_BYTES} from '../../core/resources.js';

/** Consume each native ColumnDefinition41 packet and validate the EOF boundary. */
export async function readMetadata(getPacket:()=>Promise<Buffer>,count:number):Promise<MysqlColumn[]>{
  return (await readMetadataWithStatus(getPacket,count)).columns;
}
export async function readMetadataWithStatus(
  getPacket:()=>Promise<Buffer>,count:number,allowMultiple=false
):Promise<{columns:MysqlColumn[];status:number;warnings:number}>{
  if(!Number.isSafeInteger(count)||count<0||count>MAX_COLUMNS)
    throw fail('RESOURCE_LIMIT','Invalid MySQL result column count');
  const columns:MysqlColumn[]=[];
  // Each Classic packet is bounded independently by the transport. Limit
  // the aggregate metadata too: thousands of individually valid column
  // definitions must not consume unbounded memory before rows arrive.
  let bytes=0;
  const readBounded=async():Promise<Buffer>=>{
    const packet=await getPacket();
    bytes+=packet.length;
    if(bytes>MAX_PACKET_BYTES)
      throw fail('RESOURCE_LIMIT','MySQL column metadata exceeds byte limit');
    return packet;
  };
  for(let i=0;i<count;i++)columns.push(field(await readBounded()));
  const end=eofStatus(await readBounded());
  if(!allowMultiple)assertSingleResult(end.status);
  return {columns,status:end.status,warnings:end.warnings};
}
