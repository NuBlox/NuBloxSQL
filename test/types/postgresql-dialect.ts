import {
  Connection,
  createConnection,
  createObjectName,
  descriptor,
  protocol,
  services,
  type PostgreSqlBackendMessage,
  type PostgreSqlDialectDescriptor,
  type PostgreSqlQueryResult
} from '../../packages/postgresql';

const typedDescriptor: PostgreSqlDialectDescriptor = descriptor;
const quoted: string = services.quoteIdentifier('user');
const placeholder: string = services.placeholder(1);
const objectName = createObjectName({ catalog: 'appdb', schema: 'public', name: 'users' });
const startup: Buffer = protocol.encodeStartupMessage({ user: 'stephen', database: 'nublox' });
const sslRequest: Buffer = protocol.encodeSSLRequest();
const queryMessage: Buffer = protocol.encodeQuery('SELECT 1');
const parser = new protocol.BackendMessageParser({ maxMessageSize: 1024 * 1024 });
const messages: PostgreSqlBackendMessage[] = parser.push(Buffer.alloc(0));
parser.reset();

const connection: Connection = createConnection({ user: 'stephen', password: 'secret', database: 'nublox', ssl: 'prefer' });
async function query(): Promise<PostgreSqlQueryResult<{ answer: number }>> {
  await connection.connect();
  return connection.query<{ answer: number }>('SELECT 1::int4 AS answer', { timeout: 1000 });
}

void typedDescriptor;
void quoted;
void placeholder;
void objectName;
void startup;
void sslRequest;
void queryMessage;
void messages;
void query;
