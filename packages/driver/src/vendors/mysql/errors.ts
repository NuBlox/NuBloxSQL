// @ts-nocheck
import {DriverError} from '../../core/errors.js';
import {errorPacket} from './protocol/results.js';
function serverPacket(buf){if(buf[0]===255){const e=errorPacket(buf);throw new DriverError('DATABASE_ERROR',e.message,{vendorCode:e.code,sqlState:e.state});}return buf;}
function eof(buf){return buf[0]===254&&buf.length<9;}
function isOk(buf){return buf[0]===0;}

