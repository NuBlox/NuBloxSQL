import {
  descriptor,
  services,
  protocol,
  createObjectName,
  type PostgreSqlBackendMessage,
  type PostgreSqlDialectDescriptor
} from '../../packages/postgresql';

const typedDescriptor: PostgreSqlDialectDescriptor = descriptor;
const quoted: string = services.quoteIdentifier('user');
const placeholder: string = services.placeholder(1);
const objectName = createObjectName({
  catalog: 'appdb',
  schema: 'public',
  name: 'users'
});

const startup: Buffer = protocol.encodeStartupMessage({ user: 'stephen', database: 'nublox' });
const sslRequest: Buffer = protocol.encodeSSLRequest();
const parser = new protocol.BackendMessageParser({ maxMessageSize: 1024 * 1024 });
const messages: PostgreSqlBackendMessage[] = parser.push(Buffer.alloc(0));
parser.reset();

void typedDescriptor;
void quoted;
void placeholder;
void objectName;
void startup;
void sslRequest;
void messages;
