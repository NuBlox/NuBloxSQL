import {
  DEFAULT_LIMITS,
  MySqlResultLimitError,
  createConnection,
  createPool,
  type ResultStream
} from '../../packages/mysql-cleanroom';

async function consume(stream: ResultStream<{ id: string }>): Promise<number> {
  let count = 0;
  for await (const row of stream) {
    row.id.toUpperCase();
    count++;
  }
  return count;
}

async function exercise(): Promise<void> {
  const connection = createConnection({
    user: 'test',
    maxRows: 1000,
    maxResultBytes: 1024 * 1024,
    maxRowBytes: 64 * 1024,
    streamHighWaterMark: 8
  });

  const buffered = await connection.query<{ id: string }>('SELECT id FROM example', {
    maxRows: 100,
    maxResultBytes: 512 * 1024,
    maxRowBytes: 32 * 1024
  });
  buffered.rows[0]?.id.toUpperCase();

  const stream = connection.queryStream<{ id: string }>('SELECT id FROM example', {
    highWaterMark: 4,
    maxRows: 100
  });
  await consume(stream);

  const pool = createPool({ user: 'test', connectionLimit: 2 });
  const pooled = await pool.queryStream<{ id: string }>('SELECT id FROM example', {
    acquire: { timeout: 1000 },
    highWaterMark: 2
  });
  await consume(pooled);

  DEFAULT_LIMITS.maxRows.toFixed();
  const error = new MySqlResultLimitError('limit', {
    code: 'NUBLOX_MYSQL_MAX_ROWS',
    limit: 1,
    observed: 2
  } as never);
  error.limit.toFixed();
}

void exercise;
