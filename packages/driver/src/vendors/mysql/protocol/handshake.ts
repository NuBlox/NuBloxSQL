// @ts-nocheck
import {F,Cursor,u32,utf,cstr,LIMIT} from './primitives.js';
import {token} from '../auth/plugins.js';
export function greeting(buf){const c=new Cursor(buf);if(c.byte()!==10)throw Error('Unsupported MySQL protocol');const version=c.zero(),id=c.four(),salt1=c.take(8);c.byte();const low=c.two();if(c.remaining()<16)throw Error('Short handshake');c.byte();c.two();const flags=(low|(c.two()<<16))>>>0;const n=c.byte();c.take(10);const salt2=c.take(Math.max(13,n-8));const seed=Buffer.concat([salt1,salt2]).subarray(0,n-1);const plugin=(flags&F.PLUGIN_AUTH)&&c.remaining()?c.zero():'mysql_native_password';if(seed.length<20||!version)throw Error('Invalid handshake');return {version,id,flags,seed,plugin};}
export function flags(server,secure,database){let f=F.LONG_PASSWORD|F.LONG_FLAG|F.PROTOCOL_41|F.TRANSACTIONS|F.SECURE_CONNECTION|F.PLUGIN_AUTH;if(secure)f|=F.SSL;if(database)f|=F.CONNECT_WITH_DB;if((f&server)!==f)throw Error('Server lacks required capabilities');return f;}
export const sslRequest=f=>Buffer.concat([u32(f),u32(LIMIT),Buffer.from([45]),Buffer.alloc(23)]);
export function login({f,user,password,database,seed,plugin}){const t=token(password,seed,plugin);return Buffer.concat([sslRequest(f),cstr(user),Buffer.from([t.length]),t,...(database?[cstr(database)]:[]),cstr(plugin)]);}
