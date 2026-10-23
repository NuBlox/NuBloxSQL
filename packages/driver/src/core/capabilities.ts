/** Capabilities require live vendor-version qualification; this is a vocabulary, not a support claim. */
export type DriverCapability='sql.server-prepared'|'sql.transaction'|'sql.metadata.basic'|'sql.prepared-multi-results';
export type CapabilitySet=ReadonlyArray<DriverCapability>;
export function capabilitySet<const T extends DriverCapability>(...values:T[]):readonly T[]{return Object.freeze([...values]);}
