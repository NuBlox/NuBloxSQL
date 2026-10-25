import {F,Cursor,u32,utf,cstr,LIMIT} from './primitives.js';
import {assertSupportedAuthPlugin,token} from '../auth/plugins.js';
import {DriverError,fail} from '../../../core/errors.js';
export interface MysqlGreeting {version:string;id:number;flags:number;seed:Buffer;plugin:string}
/** Decode an authenticated Classic protocol v10 greeting before transmitting
 * any client credentials. Our supported SHA-1/SHA-2 plugins require a 20-byte
 * challenge with a separately encoded trailing zero, not a truncated salt. */
export function greeting(buf:Buffer):MysqlGreeting{
  try{
    if(!Buffer.isBuffer(buf)||buf.length>4096)
      throw fail('PROTOCOL_ERROR','Invalid MySQL greeting size');
    const c=new Cursor(buf);
    if(c.byte()!==10)
      throw fail('PROTOCOL_ERROR','Unsupported MySQL greeting protocol');
    const version=c.zero();
    const id=c.four();
    const part1=c.take(8);
    if(c.byte()!==0)
      throw fail('PROTOCOL_ERROR','Malformed MySQL greeting salt separator');
    const lowerCapabilities=c.two();
    const characterSet=c.byte();
    c.two(); // server status flags
    const serverCapabilities=(lowerCapabilities|(c.two()<<16))>>>0;
    const challengeLength=c.byte();
    const reserved=c.take(10);
    // This native client requires CLIENT_PLUGIN_AUTH; modern supported
    // plugins use 20 challenge bytes plus one final NUL (length 21).
    if(!(serverCapabilities&F.PLUGIN_AUTH)||challengeLength!==21)
      throw fail('PROTOCOL_ERROR','Invalid MySQL greeting authentication metadata');
    const part2=c.take(13);
    if(part2[12]!==0)
      throw fail('PROTOCOL_ERROR','Malformed MySQL greeting challenge terminator');
    const plugin=c.zero();
    if(!version||!plugin||!characterSet||c.remaining()!==0)
      throw fail('PROTOCOL_ERROR','Malformed MySQL greeting fields');
    return {
      version,id,flags:serverCapabilities,
      seed:Buffer.concat([part1,part2.subarray(0,12)]),
      plugin
    };
  }catch(error){
    if(error instanceof DriverError)throw error;
    throw fail('PROTOCOL_ERROR','Malformed MySQL server greeting');
  }
}
export function flags(server:number,secure:boolean,database?:string):number{let f=F.LONG_PASSWORD|F.LONG_FLAG|F.PROTOCOL_41|F.TRANSACTIONS|F.SECURE_CONNECTION|F.PLUGIN_AUTH|F.MULTI_RESULTS|F.PS_MULTI_RESULTS;if(secure)f|=F.SSL;if(database)f|=F.CONNECT_WITH_DB;if((f&server)!==f)throw Error('Server lacks required capabilities');return f;}
export const sslRequest=(f:number):Buffer=>Buffer.concat([u32(f),u32(LIMIT),Buffer.from([45]),Buffer.alloc(23)]);
export interface MysqlLogin {f:number;user:string;password:string;database?:string;seed:Buffer;plugin:string}
export function login({f,user,password,database,seed,plugin}:MysqlLogin):Buffer{const t=token(password,seed,plugin);return Buffer.concat([sslRequest(f),cstr(user),Buffer.from([t.length]),t,...(database?[cstr(database)]:[]),cstr(plugin)]);}

/** COM_AUTH_SWITCH_REQUEST is permitted only for the two implemented
 * 20-byte challenge/response plugins. A trailing terminator is optional.
 * Never hash a truncated, absent or overlong challenge. */
export function authSwitchRequest(packet:Buffer):{plugin:string;seed:Buffer}{
  try{
    const c=new Cursor(packet);
    if(c.byte()!==0xfe)
      throw fail('PROTOCOL_ERROR','Invalid MySQL authentication switch packet');
    const plugin=c.zero();
    assertSupportedAuthPlugin(plugin);
    const remaining=c.take(c.remaining());
    if(remaining.length===20)return {plugin,seed:remaining};
    if(remaining.length===21&&remaining[20]===0)
      return {plugin,seed:remaining.subarray(0,20)};
    throw fail('PROTOCOL_ERROR','Malformed MySQL authentication challenge');
  }catch(error){
    if(error instanceof DriverError)throw error;
    throw fail('PROTOCOL_ERROR','Malformed MySQL authentication switch packet');
  }
}

/** caching_sha2_password AuthMoreData: 0x03 fast-auth success or 0x04
 * full authentication over a verified TLS channel. Extra bytes are invalid. */
export function cachingSha2AuthMore(packet:Buffer):3|4{
  if(packet.length!==2||packet[0]!==1)
    throw fail('PROTOCOL_ERROR','Malformed MySQL authentication status packet');
  if(packet[1]!==3&&packet[1]!==4)
    throw fail('AUTH_UNSUPPORTED','Unsupported MySQL authentication continuation');
  return packet[1] as 3|4;
}
