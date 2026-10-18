import {field} from './protocol/results.js';
import type {MysqlColumn} from '../../core/contracts.js';
import {eof} from './errors.js';
import {fail} from '../../core/errors.js';
import {MAX_COLUMNS} from '../../core/resources.js';
/** Read field definitions and the legacy EOF boundary from the native MySQL stream. */
export async function readMetadata(getPacket:()=>Promise<Buffer>,count:number):Promise<MysqlColumn[]>{if(!Number.isSafeInteger(count)||count>MAX_COLUMNS)throw fail('RESOURCE_LIMIT','Too many columns');const cols=[];for(let i=0;i<count;i++)cols.push(field(await getPacket()));const end=await getPacket();if(!eof(end))throw Error('Missing MySQL metadata terminator');return cols;}
