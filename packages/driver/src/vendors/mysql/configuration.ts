import {fail} from '../../core/errors.js';
import {validDeadline} from '../../core/resources.js';
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
    timeoutMs=15000
  }=target;

  if(typeof host!=='string'||!host||containsNul(host)||
    !Number.isInteger(port)||port<1||port>65535||
    typeof user!=='string'||!user||containsNul(user)||
    typeof password!=='string'||containsNul(password)||
    (database!==undefined&&
      (typeof database!=='string'||!database||containsNul(database)))||
    !validDeadline(timeoutMs))
    throw fail('INVALID_INPUT','Invalid MySQL connection target');

  if(security!=='verified-tls'&&security!=='isolated-local')
    throw fail('INVALID_INPUT','Explicit verified-tls or isolated-local security is required');

  if(security==='isolated-local'&&!['127.0.0.1','::1'].includes(host))
    throw fail('INVALID_INPUT','Unencrypted connections are restricted to literal loopback addresses');

  if(security==='verified-tls'&&(
    (ca!==undefined&&
      (typeof ca!=='string'||!ca.trim()||containsNul(ca)))||
    (serverName!==undefined&&
      (typeof serverName!=='string'||!serverName.trim()||containsNul(serverName)))
  ))
    throw fail('INVALID_INPUT','Invalid TLS identity configuration');

  return {...target,timeoutMs};
}
