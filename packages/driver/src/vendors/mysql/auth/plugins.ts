import {createHash} from 'node:crypto';
import {fail} from '../../../core/errors.js';
import {utf} from '../protocol/primitives.js';

/** Only implemented authentication exchanges may be negotiated, even for
 * accounts with an empty password (which send a zero-length token). */
export function assertSupportedAuthPlugin(plugin:string):void {
  if(plugin!=='caching_sha2_password'&&plugin!=='mysql_native_password')
    throw fail('AUTH_UNSUPPORTED','Unsupported MySQL authentication plugin');
}

export function token(password:string,seed:Buffer,plugin:string):Buffer{
  assertSupportedAuthPlugin(plugin);
  if(!password)return Buffer.alloc(0);
  const pw=utf(password);
  const sha=(name:'sha256'|'sha1',b:Buffer)=>
    createHash(name).update(b).digest();
  if(plugin==='caching_sha2_password'){
    const a=sha('sha256',pw),b=sha('sha256',a);
    const c=sha('sha256',Buffer.concat([b,seed]));
    return Buffer.from(a.map((v,i)=>v^c[i]));
  }
  const a=sha('sha1',pw),b=sha('sha1',a);
  const c=sha('sha1',Buffer.concat([seed,b]));
  return Buffer.from(a.map((v,i)=>v^c[i]));
}
