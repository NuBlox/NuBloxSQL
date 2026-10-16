'use strict';

// Base SQL transaction coordination only. TransactionIntegration owns
// normalization, nested savepoints, retry policy and observability wrapping.
// Inject the Client constructor to avoid an internal circular import.
async function run(client, Client, fn, options) {
  if (typeof fn !== 'function') throw new TypeError('NuBloxSQL transaction requires a function');
  options = options || {};
  var self = client;

  if (client._isPool && typeof client._target.withTransaction === 'function') {
    return client._target.withTransaction(async function (connection) {
      var transactionClient = new Client(self.adapter, self.dialect, self.config, connection, false);
      try { return await fn(transactionClient); }
      finally { await transactionClient._closePreparedStatements(); }
    }, options);
  }

  var connection = await client._ensureConnected();
  if (client.dialect === 'sqlite') {
    connection.begin(options.mode || 'deferred');
    var sqliteTransactionClient = new Client(client.adapter, client.dialect, client.config, connection, false);
    try {
      var value = await fn(sqliteTransactionClient);
      await sqliteTransactionClient._closePreparedStatements();
      connection.commit();
      return value;
    } catch (error) {
      try { await sqliteTransactionClient._closePreparedStatements(); } catch (resourceError) { error.resourceError = resourceError; }
      try { connection.rollback(); } catch (rollbackError) { error.rollbackError = rollbackError; }
      throw error;
    }
  }

  if (typeof connection.withTransaction !== 'function') throw new Error('NuBloxSQL dialect "' + client.dialect + '" does not support transactions');
  return connection.withTransaction(async function (transactionConnection) {
    var transactionClient = new Client(self.adapter, self.dialect, self.config, transactionConnection, false);
    try { return await fn(transactionClient); }
    finally { await transactionClient._closePreparedStatements(); }
  }, options);
}

module.exports = Object.freeze({run});
