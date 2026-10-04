'use strict';

var ACTION_CAPABILITY = Object.freeze({
  'no-action': Object.freeze({ delete: 'integrity.onDeleteNoAction', update: 'integrity.onUpdateNoAction' }),
  restrict: Object.freeze({ delete: 'integrity.onDeleteRestrict', update: 'integrity.onUpdateRestrict' }),
  cascade: Object.freeze({ delete: 'integrity.onDeleteCascade', update: 'integrity.onUpdateCascade' }),
  'set-null': Object.freeze({ delete: 'integrity.onDeleteSetNull', update: 'integrity.onUpdateSetNull' }),
  'set-default': Object.freeze({ delete: 'integrity.onDeleteSetDefault', update: 'integrity.onUpdateSetDefault' })
});
var MATCH_CAPABILITY = Object.freeze({
  simple: 'integrity.matchSimple',
  full: 'integrity.matchFull',
  partial: 'integrity.matchPartial'
});

function has(reference) {
  return !!(reference && (
    reference.match !== undefined ||
    reference.onDelete !== undefined ||
    reference.onUpdate !== undefined ||
    reference.deferrable !== undefined ||
    reference.initially !== undefined
  ));
}

function tokenWord(token) {
  if (!token) return '';
  var value = token.value !== null && token.value !== undefined ? token.value : token.raw;
  return String(value || '').toUpperCase();
}

function parseAction(api) {
  var token = api.take();
  var action = tokenWord(token);
  if (action === 'CASCADE') return 'cascade';
  if (action === 'RESTRICT') return 'restrict';
  if (action === 'NO') {
    if (tokenWord(api.take()) !== 'ACTION') api.fail('Expected ACTION after NO');
    return 'no-action';
  }
  if (action === 'SET') {
    var target = tokenWord(api.take());
    if (target === 'NULL') return 'set-null';
    if (target === 'DEFAULT') return 'set-default';
    api.fail('Expected NULL or DEFAULT after SET');
  }
  api.fail('Expected foreign-key referential action');
}

function setOnce(result, key, value, api) {
  if (Object.prototype.hasOwnProperty.call(result, key)) api.fail('Duplicate foreign-key ' + key + ' clause');
  result[key] = value;
}

function parseTail(api) {
  var result = {};
  while (!api.atEnd()) {
    if (api.word('MATCH')) {
      api.take();
      if (api.word('SIMPLE')) { api.take(); setOnce(result, 'match', 'simple', api); continue; }
      if (api.word('FULL')) { api.take(); setOnce(result, 'match', 'full', api); continue; }
      if (api.word('PARTIAL')) { api.take(); setOnce(result, 'match', 'partial', api); continue; }
      api.fail('Expected SIMPLE, FULL or PARTIAL after MATCH');
    }
    if (api.word('ON')) {
      api.take();
      if (api.word('DELETE')) { api.take(); setOnce(result, 'onDelete', parseAction(api), api); continue; }
      if (api.word('UPDATE')) { api.take(); setOnce(result, 'onUpdate', parseAction(api), api); continue; }
      api.fail('Expected DELETE or UPDATE after ON');
    }
    if (api.word('DEFERRABLE')) {
      api.take(); setOnce(result, 'deferrable', true, api); continue;
    }
    if (api.word('NOT')) {
      api.take();
      if (!api.word('DEFERRABLE')) api.fail('Expected DEFERRABLE after NOT in foreign-key clause');
      api.take(); setOnce(result, 'deferrable', false, api); continue;
    }
    if (api.word('INITIALLY')) {
      api.take();
      if (api.word('DEFERRED')) { api.take(); setOnce(result, 'initially', 'deferred', api); continue; }
      if (api.word('IMMEDIATE')) { api.take(); setOnce(result, 'initially', 'immediate', api); continue; }
      api.fail('Expected DEFERRED or IMMEDIATE after INITIALLY');
    }
    api.fail('Unsupported foreign-key option');
  }
  validate(result);
  return result;
}

function actionValid(value) { return !!ACTION_CAPABILITY[value]; }
function validate(reference) {
  if (!reference || typeof reference !== 'object') throw new TypeError('Foreign-key reference is required');
  if (reference.match !== undefined && !MATCH_CAPABILITY[reference.match]) throw new RangeError('Invalid foreign-key MATCH mode');
  if (reference.onDelete !== undefined && !actionValid(reference.onDelete)) throw new RangeError('Invalid ON DELETE action');
  if (reference.onUpdate !== undefined && !actionValid(reference.onUpdate)) throw new RangeError('Invalid ON UPDATE action');
  if (reference.deferrable !== undefined && typeof reference.deferrable !== 'boolean') throw new TypeError('Foreign-key deferrable state must be boolean when present');
  if (reference.initially !== undefined && reference.initially !== 'deferred' && reference.initially !== 'immediate') throw new RangeError('Invalid foreign-key INITIALLY mode');
  if (reference.initially === 'deferred' && reference.deferrable !== true) throw new RangeError('INITIALLY DEFERRED requires DEFERRABLE in the released ddl-v7 semantic model');
  return reference;
}

function capabilities(reference) {
  validate(reference);
  var result = [];
  if (reference.match !== undefined) result.push(MATCH_CAPABILITY[reference.match]);
  if (reference.onDelete !== undefined) result.push(ACTION_CAPABILITY[reference.onDelete].delete);
  if (reference.onUpdate !== undefined) result.push(ACTION_CAPABILITY[reference.onUpdate].update);
  if (reference.deferrable === true) result.push('integrity.deferrableForeignKeys');
  if (reference.deferrable === false) result.push('integrity.notDeferrableForeignKeys');
  if (reference.initially === 'deferred') result.push('integrity.initiallyDeferred');
  if (reference.initially === 'immediate') result.push('integrity.initiallyImmediate');
  return result;
}

function actionSql(value) {
  return {
    'no-action': 'NO ACTION',
    restrict: 'RESTRICT',
    cascade: 'CASCADE',
    'set-null': 'SET NULL',
    'set-default': 'SET DEFAULT'
  }[value];
}

function suffix(reference) {
  validate(reference);
  var sql = '';
  if (reference.match !== undefined) sql += ' MATCH ' + reference.match.toUpperCase();
  if (reference.onDelete !== undefined) sql += ' ON DELETE ' + actionSql(reference.onDelete);
  if (reference.onUpdate !== undefined) sql += ' ON UPDATE ' + actionSql(reference.onUpdate);
  if (reference.deferrable === true) sql += ' DEFERRABLE';
  else if (reference.deferrable === false) sql += ' NOT DEFERRABLE';
  if (reference.initially !== undefined) sql += ' INITIALLY ' + reference.initially.toUpperCase();
  return sql;
}

function validateSourceDialect(dialect, reference) {
  validate(reference);
  if ((dialect === 'mysql' || dialect === 'sqlite') && reference.match !== undefined) {
    throw new SyntaxError(dialect + ' does not provide the explicit MATCH semantics represented by ddl-v7');
  }
  if (dialect === 'postgresql' && reference.match === 'partial') throw new SyntaxError('PostgreSQL MATCH PARTIAL is not implemented');
  if (dialect === 'mysql' && (reference.deferrable !== undefined || reference.initially !== undefined)) {
    throw new SyntaxError('MySQL does not support DEFERRABLE foreign-key semantics');
  }
  if (dialect === 'mysql' && (reference.onDelete === 'set-default' || reference.onUpdate === 'set-default')) {
    throw new SyntaxError('MySQL supported storage engines reject SET DEFAULT foreign-key actions');
  }
}

function validateTargetDialect(dialect, reference) {
  validate(reference);
  if ((dialect === 'mysql' || dialect === 'sqlite') && reference.match !== undefined) {
    throw new RangeError('ddl-v7 will not render explicit MATCH semantics to ' + dialect);
  }
  if (dialect === 'postgresql' && reference.match === 'partial') throw new RangeError('PostgreSQL MATCH PARTIAL is not implemented');
  if (dialect === 'mysql' && (reference.deferrable !== undefined || reference.initially !== undefined)) {
    throw new RangeError('MySQL does not support DEFERRABLE foreign-key semantics');
  }
  if (dialect === 'mysql' && (reference.onDelete === 'set-default' || reference.onUpdate === 'set-default')) {
    throw new RangeError('MySQL supported storage engines reject SET DEFAULT foreign-key actions');
  }
}

function collect(ast) {
  var refs = [];
  if (!ast || typeof ast !== 'object') return refs;
  if (ast.type === 'CreateTableStatement') {
    (ast.columns || []).forEach(function (column) { if (column.references) refs.push(column.references); });
    (ast.constraints || []).forEach(function (constraint) {
      if (constraint && constraint.type === 'ForeignKeyConstraint' && constraint.references) refs.push(constraint.references);
    });
  } else if (ast.type === 'AlterTableStatement' && ast.action && ast.action.type === 'AddConstraintAction') {
    var constraint = ast.action.constraint;
    if (constraint && constraint.type === 'ForeignKeyConstraint' && constraint.references) refs.push(constraint.references);
  }
  return refs;
}

function isForeignKeyAdd(ast) {
  return !!(ast && ast.type === 'AlterTableStatement' && ast.action && ast.action.type === 'AddConstraintAction' &&
    ast.action.constraint && ast.action.constraint.type === 'ForeignKeyConstraint');
}

exports.ACTION_CAPABILITY = ACTION_CAPABILITY;
exports.MATCH_CAPABILITY = MATCH_CAPABILITY;
exports.has = has;
exports.parseTail = parseTail;
exports.validate = validate;
exports.capabilities = capabilities;
exports.suffix = suffix;
exports.validateSourceDialect = validateSourceDialect;
exports.validateTargetDialect = validateTargetDialect;
exports.collect = collect;
exports.isForeignKeyAdd = isForeignKeyAdd;
