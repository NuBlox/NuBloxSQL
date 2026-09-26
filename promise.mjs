import mysql from './promise.js';

export default mysql;

export const createConnection = mysql.createConnection;
export const createPool = mysql.createPool;
export const escape = mysql.escape;
export const escapeId = mysql.escapeId;
export const format = mysql.format;
export const raw = mysql.raw;
export const Types = mysql.Types;
