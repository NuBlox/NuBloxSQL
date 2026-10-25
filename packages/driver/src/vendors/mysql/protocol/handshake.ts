import {F,Cursor,u32,utf,cstr,LIMIT} from './primitives.js';
import {assertSupportedAuthPlugin,token} from '../auth/plugins.js';
import {DriverError,fail} from '../../../core/errors.js';
export interface MysqlGreeting {version:string;id:number;flags:number;seed:Buffer;plugin:string}
export function greeting(buf:Buffer):MysqlGreeting{const c=new Cursor(buf);if(c.byte()!==10)throw Error('Unsupported MySQL protocol');const version=c.zero(),id=c.four(),salt1=c.take(8);c.byte();const low=c.two();if(c.remaining()<16)throw Error('Short handshake');c.byte();c.two();const flags=(low|(c.two()<<16))>>>0;const n=c.byte();c.take(10);const salt2=c.take(Math.max(13,n-8));const seed=Buffer.concat([salt1,salt2]).subarray(0,n-1);const plugin=(flags&F.PLUGIN_AUTH)&&c.remaining()?c.zero():'mysql_native_password';if(seed.length<20||!version)throw Error('Invalid handshake');return {version,id,flags,seed,plugin};}
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
