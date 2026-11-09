import {fail} from '../../core/errors.js';
import {validDeadline} from '../../core/resources.js';
import {wellFormedUtf16} from './protocol/primitives.js';
import type {MysqlTarget} from '../../core/contracts.js';

const containsNul=(value:string):boolean=>value.includes('\0');

/** Reject ambiguous C-string credentials and identity parameters before a
 * socket is created. MySQL Classic login encodes the user, optional database,
 * and full-TLS-auth password as NUL-terminated strings. */
export function validate(target:MysqlTarget):MysqlTarget & {timeoutMs:number}{
  if(!target||typeof target!=='object'||target.engine!=='mysql')
    throw fail('UNSUPPORTED_ENGINE','Only the MySQL native adapter is implemented');

  const {
    host,port,user,password,database,security,ca,serverName,
    timeoutMs=15000,statementCacheSize=0
  }=target;

  if(typeof host!=='string'||!host||containsNul(host)||!wellFormedUtf16(host)||
    !Number.isInteger(port)||port<1||port>65535||
    typeof user!=='string'||!user||containsNul(user)||!wellFormedUtf16(user)||
    typeof password!=='string'||containsNul(password)||!wellFormedUtf16(password)||
    (database!==undefined&&
      (typeof database!=='string'||!database||containsNul(database)||!wellFormedUtf16(database)))||
    !validDeadline(timeoutMs)||
    !Number.isSafeInteger(statementCacheSize)||
    statementCacheSize<0||statementCacheSize>16)
    throw fail('INVALID_INPUT','Invalid MySQL connection target');

  if(security!=='verified-tls'&&security!=='isolated-local')
    throw fail('INVALID_INPUT','Explicit verified-tls or isolated-local security is required');

  if(security==='isolated-local'&&!['127.0.0.1','::1'].includes(host))
    throw fail('INVALID_INPUT','Unencrypted connections are restricted to literal loopback addresses');

  if(security==='verified-tls'&&(
    (ca!==undefined&&
      (typeof ca!=='string'||!ca.trim()||containsNul(ca)||!wellFormedUtf16(ca)))||
    (serverName!==undefined&&
      (typeof serverName!=='string'||!serverName.trim()||containsNul(serverName)||!wellFormedUtf16(serverName)))
  ))
    throw fail('INVALID_INPUT','Invalid TLS identity configuration');

  return {...target,timeoutMs};
}
