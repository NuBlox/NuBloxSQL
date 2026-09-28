import mysql from './index.js';

export default mysql;

export const createConnection = mysql.createConnection;
export const createPool = mysql.createPool;
export const createPoolCluster = mysql.createPoolCluster;
export const probePoolClusterRoles = mysql.probePoolClusterRoles;
export const createQuery = mysql.createQuery;
export const escape = mysql.escape;
export const escapeId = mysql.escapeId;
export const format = mysql.format;
export const raw = mysql.raw;
export const param = mysql.param;
export const Types = mysql.Types;
export const PromiseConnection = mysql.PromiseConnection;
export const PromisePool = mysql.PromisePool;
