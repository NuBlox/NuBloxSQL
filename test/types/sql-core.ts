import {
  CAPABILITIES,
  CAPABILITY_LEVELS,
  DIALECT_FAMILIES,
  SqlAdapterExtension,
  SqlCapabilityEntry,
  SqlCapabilityProfile,
  SqlDialectDescriptor,
  SqlExecutionRequest,
  SqlExecutionResult,
  SqlObjectName,
  SqlTransactionOptions,
  capabilityProfileToBooleanMap,
  createCapabilityProfile,
  createDialectDescriptor,
  createObjectName
} from '../../packages/sql-core';

const profile: SqlCapabilityProfile = createCapabilityProfile({
  [CAPABILITIES.PREPARED_STATEMENTS]: {
    level: CAPABILITY_LEVELS.NATIVE,
    since: '4.1'
  },
  [CAPABILITIES.CHANGE_DATA_CAPTURE]: {
    level: CAPABILITY_LEVELS.CONDITIONAL,
    requires: ['binary-log']
  },
  [CAPABILITIES.RETURNING]: false
});

const capabilityMap = capabilityProfileToBooleanMap(profile);

const descriptor: SqlDialectDescriptor = createDialectDescriptor({
  identity: {
    family: DIALECT_FAMILIES.POSTGRESQL,
    name: 'PostgreSQL',
    edition: 'Community',
    distribution: 'upstream'
  },
  capabilityProfile: {
    [CAPABILITIES.PREPARED_STATEMENTS]: {level: CAPABILITY_LEVELS.NATIVE},
    [CAPABILITIES.SCHEMAS]: true,
    [CAPABILITIES.COPY_PROTOCOL]: {level: CAPABILITY_LEVELS.NATIVE}
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

const capability: SqlCapabilityEntry = descriptor.capability(CAPABILITIES.COPY_PROTOCOL);

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

void profile;
void capabilityMap;
void descriptor;
void capability;
void request;
void result;
void transaction;
void objectName;
void extension;
