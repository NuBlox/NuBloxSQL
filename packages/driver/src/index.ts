/** Public NuBloxSQL Driver API: adapter implementations remain private. */
export {inspectDatabase, InspectionError} from './operations/inspect-database.js';
export type {InventoryV1, InventoryStatus, PostgresProfile, InspectOptions, InspectionCode} from './operations/inspect-database.js';

// Independently consumable, model-specific multi-DBMS client API.
export {connectDatabase, DriverError} from './client.js';
export type {DatabaseTarget, PostgreSqlTarget, RelationalEngine, SqlDatabaseInfo, SqlDatabaseSession, DriverCapability, ClientFailureCode, SqliteTarget, SqlBoundValue, SqlResult} from './client.js';
