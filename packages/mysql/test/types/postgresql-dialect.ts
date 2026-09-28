import {
  descriptor,
  services,
  createObjectName,
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

void typedDescriptor;
void quoted;
void placeholder;
void objectName;
