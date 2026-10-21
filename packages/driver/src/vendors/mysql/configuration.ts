import {fail} from '../../core/errors.js';
import {validDeadline} from '../../core/resources.js';
import type {MysqlTarget} from '../../core/contracts.js';
export function validate(t:MysqlTarget):MysqlTarget & {timeoutMs:number}{if(!t||typeof t!=='object'||t.engine!=='mysql')throw fail('UNSUPPORTED_ENGINE','Only the MySQL native adapter is implemented');const {host,port,user,password,database,security,timeoutMs=15000}=t;
 if(typeof host!=='string'||!host||!Number.isInteger(port)||port<1||port>65535||typeof user!=='string'||!user||typeof password!=='string'||(database!==undefined&&(typeof database!=='string'||!database))||!validDeadline(timeoutMs))throw fail('INVALID_INPUT','Invalid MySQL connection target');
 if(security!=='verified-tls'&&security!=='isolated-local')throw fail('INVALID_INPUT','Explicit verified-tls or isolated-local security is required');
 if(security==='isolated-local'&&!['127.0.0.1','::1'].includes(host))throw fail('INVALID_INPUT','Unencrypted connections are restricted to literal loopback addresses');
 if(security==='verified-tls'&&(t.ca!==undefined&&typeof t.ca!=='string'||t.serverName!==undefined&&typeof t.serverName!=='string'))throw fail('INVALID_INPUT','Invalid TLS identity configuration');
 return {...t,timeoutMs};}
