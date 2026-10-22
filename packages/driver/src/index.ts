export {connectDatabase} from './core/connection.js';
export {DriverError} from './core/errors.js';
export {MysqlSession} from './vendors/mysql/adapter.js';
export type {BindValue,MysqlTarget,DatabaseTarget,MysqlColumn,QueryResult,SessionInfo} from './core/contracts.js';
export type {RelationalSession,RelationalTransaction} from './models/relational.js';

export type {OperationOptions} from './core/resources.js';

export {createDatabasePool} from './core/connection.js';
export type {DatabasePool,PoolOptions,PoolStats,PooledRelationalSession} from './core/pooling.js';
