/** Shared guardrails; native engines may enforce stricter limits. */
export const MAX_PACKET_BYTES=8*1024*1024;
export const MAX_RESULT_ROWS=10_000;
export const MAX_COLUMNS=4096;
export const MAX_PARAMETERS=64;
export function validDeadline(timeoutMs:number):boolean{return Number.isSafeInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=120_000;}
