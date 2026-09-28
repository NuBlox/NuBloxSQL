import mysql = require('../../index');
import promiseMysql = require('../../promise');

type CursorRow = {
  value: number;
};

const callbackConnection = mysql.createConnection({});

callbackConnection.openCursor<CursorRow>(
  'SELECT ? AS value',
  [1],
  {fetchSize: 16},
  (openError, cursor) => {
    if (openError || !cursor) {
      return;
    }

    const statementId: number = cursor.statementId;
    const fields: mysql.FieldInfo[] = cursor.fields;
    const done: boolean = cursor.done;
    const closed: boolean = cursor.closed;

    void statementId;
    void fields;
    void done;
    void closed;

    cursor.fetch(8, (fetchError, rows, state) => {
      if (fetchError) {
        return;
      }

      const value: number | undefined = rows && rows[0] && rows[0].value;
      const batchDone: boolean | undefined = state && state.done;

      void value;
      void batchDone;
    });

    cursor.close();
  }
);

const promiseConnection = promiseMysql.createConnection({});

async function verifyPromiseCursor(): Promise<void> {
  const cursor = await promiseConnection.openCursor<CursorRow>(
    'SELECT ? AS value',
    [1],
    {fetchSize: 16}
  );

  const batch = await cursor.fetch(8);
  const value: number | undefined = batch.rows[0] && batch.rows[0].value;
  const batchDone: boolean = batch.done;
  const fields: mysql.FieldInfo[] = batch.fields;

  void value;
  void batchDone;
  void fields;

  for await (const row of cursor) {
    const iteratedValue: number = row.value;
    void iteratedValue;
    break;
  }

  await cursor.close();
}

void verifyPromiseCursor;
