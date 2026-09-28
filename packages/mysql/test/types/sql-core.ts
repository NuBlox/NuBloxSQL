import {
  CAPABILITIES,
  DIALECT_FAMILIES,
  SqlAdapterExtension,
  SqlDialectDescriptor,
  SqlExecutionRequest,
  SqlExecutionResult,
  SqlObjectName,
  SqlTransactionOptions,
  createDialectDescriptor,
  createObjectName
} from '../../packages/sql-core';

const descriptor: SqlDialectDescriptor = createDialectDescriptor({
  identity: {
    family: DIALECT_FAMILIES.POSTGRESQL,
    name: 'PostgreSQL'
  },
  capabilities: {
    [CAPABILITIES.PREPARED_STATEMENTS]: true,
    [CAPABILITIES.SCHEMAS]: true
  },
  services: {
    quoteIdentifier(identifier: string): string {
      return `"${identifier}"`;
    },
    placeholder(index: number): string {
      return `$${index}`;
    }
  }
});

const request: SqlExecutionRequest = {
  sql: 'SELECT $1',
  parameters: [42],
  signal: new AbortController().signal
};

const result: SqlExecutionResult<{value: number}> = {
  kind: 'rows',
  rows: [{value: 42}],
  fields: [{name: 'value', nativeType: 23}]
};

const transaction: SqlTransactionOptions = {
  isolationLevel: 'serializable',
  readOnly: true
};

const objectName: Readonly<SqlObjectName> = createObjectName({
  catalog: 'app',
  schema: 'public',
  name: 'users'
});

const extension: SqlAdapterExtension<{oid: number}> = {
  native: {oid: 23}
};

void descriptor;
void request;
void result;
void transaction;
void objectName;
void extension;
