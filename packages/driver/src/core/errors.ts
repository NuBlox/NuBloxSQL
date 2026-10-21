export type DriverErrorCode='UNSUPPORTED_ENGINE'|'INVALID_INPUT'|'CONNECTION_FAILED'|'CONNECTION_CLOSED'|'DATABASE_ERROR'|'RESOURCE_LIMIT'|'TIMEOUT'|'CANCELLED'|'TLS_FAILED'|'AUTH_UNSUPPORTED'|'UNSUPPORTED_FEATURE';
export interface ErrorDetail {vendorCode?:number;sqlState?:string}
export class DriverError extends Error {
  readonly code:DriverErrorCode;
  readonly vendorCode:number|null;
  readonly sqlState:string|null;
  constructor(code:DriverErrorCode,message:string,detail:ErrorDetail={}){super(message);this.name='DriverError';this.code=code;this.vendorCode=detail.vendorCode??null;this.sqlState=detail.sqlState??null;}
}
export function fail(code:DriverErrorCode,message:string):DriverError{return new DriverError(code,message);}
