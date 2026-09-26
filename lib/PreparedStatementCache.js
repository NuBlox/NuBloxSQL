'use strict';

module.exports = PreparedStatementCache;

function PreparedStatementCache(limit) {
  this.limit = limit;
  this.entries = new Map();
  this.hits = 0;
  this.misses = 0;
  this.prepares = 0;
  this.evictions = 0;
  this.invalidations = 0;
  this.reprepares = 0;
}

PreparedStatementCache.prototype.get = function get(sql) {
  if (this.limit === 0) {
    this.misses++;
    return null;
  }

  var statement = this.entries.get(sql);

  if (!statement) {
    this.misses++;
    return null;
  }

  this.entries.delete(sql);
  this.entries.set(sql, statement);
  this.hits++;
  return statement;
};

PreparedStatementCache.prototype.notePrepare = function notePrepare() {
  this.prepares++;
};

PreparedStatementCache.prototype.noteReprepare = function noteReprepare() {
  this.reprepares++;
};

PreparedStatementCache.prototype.set = function set(sql, statement) {
  var removed = [];

  if (this.limit === 0) {
    return removed;
  }

  var existing = this.entries.get(sql);

  if (existing && existing.id !== statement.id) {
    this.entries.delete(sql);
    removed.push(existing);
    this.invalidations++;
  }

  this.entries.set(sql, statement);

  while (this.entries.size > this.limit) {
    var oldestKey = this.entries.keys().next().value;
    var oldest = this.entries.get(oldestKey);

    this.entries.delete(oldestKey);
    removed.push(oldest);
    this.evictions++;
  }

  return removed;
};

PreparedStatementCache.prototype.delete = function remove(sql) {
  var statement = this.entries.get(sql);

  if (!statement) {
    return null;
  }

  this.entries.delete(sql);
  this.invalidations++;
  return statement;
};

PreparedStatementCache.prototype.clear = function clear() {
  var statements = Array.from(this.entries.values());

  if (statements.length > 0) {
    this.invalidations += statements.length;
  }

  this.entries.clear();
  return statements;
};

PreparedStatementCache.prototype.stats = function stats() {
  var requests = this.hits + this.misses;

  return {
    limit         : this.limit,
    size          : this.entries.size,
    hits          : this.hits,
    misses        : this.misses,
    hitRate       : requests === 0 ? null : this.hits / requests,
    prepares      : this.prepares,
    evictions     : this.evictions,
    invalidations : this.invalidations,
    reprepares    : this.reprepares
  };
};
