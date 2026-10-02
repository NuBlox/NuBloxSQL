'use strict';

function quoteIdentifier(dialect, value) {
  var quote = dialect === 'mysql' ? '`' : '"';
  var escaped = String(value).replace(new RegExp(quote, 'g'), quote + quote);
  return quote + escaped + quote;
}

function createBinder(dialect) {
  var targetToSource = [];
  var assigned = Object.create(null);
  var next = 1;
  function key(binding) { return typeof binding + ':' + String(binding); }
  function marker(binding) {
    if (dialect === 'mysql') {
      targetToSource.push(binding);
      return '?';
    }
    var k = key(binding);
    if (!assigned[k]) assigned[k] = next++;
    var index = assigned[k];
    if (!targetToSource[index - 1]) targetToSource[index - 1] = binding;
    return dialect === 'postgresql' ? '$' + index : '?' + index;
  }
  return { marker: marker, targetToSource: targetToSource };
}

function compile(ast, dialect) {
  var binder = createBinder(dialect);
  var generatedAlias = 0;

  function functionName(node) {
    if (!node || node.type !== 'Identifier') throw new TypeError('SQL function name must be an Identifier');
    node.parts.forEach(function (part) {
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(part)) throw new TypeError('Unsupported SQL function identifier: ' + part);
    });
    return node.parts.join('.');
  }

  function expr(node) {
    if (!node || typeof node !== 'object') throw new TypeError('Invalid SQL AST expression');
    if (node.type === 'Identifier') return node.parts.map(function (part) { return quoteIdentifier(dialect, part); }).join('.');
    if (node.type === 'Wildcard') return node.qualifier ? expr(node.qualifier) + '.*' : '*';
    if (node.type === 'Literal') {
      if (node.value === null) return 'NULL';
      if (node.value === true) return 'TRUE';
      if (node.value === false) return 'FALSE';
      if (typeof node.value === 'number') return String(node.value);
      if (typeof node.value === 'string') return "'" + node.value.replace(/'/g, "''") + "'";
      throw new TypeError('Unsupported SQL AST literal value');
    }
    if (node.type === 'Parameter') return binder.marker(node.binding);
    if (node.type === 'CallExpression') return functionName(node.name) + '(' + node.arguments.map(expr).join(', ') + ')';
    if (node.type === 'UnaryExpression') return node.operator + ' ' + expr(node.argument);
    if (node.type === 'BinaryExpression') return '(' + expr(node.left) + ' ' + node.operator + ' ' + expr(node.right) + ')';
    if (node.type === 'ListExpression') return '(' + node.items.map(expr).join(', ') + ')';
    if (node.type === 'AliasedExpression') return expr(node.expression) + ' AS ' + expr(node.alias);
    if (node.type === 'SubqueryExpression') return '(' + statement(node.query) + ')';
    if (node.type === 'ExistsExpression') return 'EXISTS (' + statement(node.query) + ')';
    throw new TypeError('Unsupported SQL AST expression node: ' + node.type);
  }

  function relation(node) {
    if (!node || typeof node !== 'object') throw new TypeError('Invalid SQL AST relation');
    if (node.type === 'TableReference') {
      var tableSql = expr(node.name);
      if (node.alias) tableSql += ' AS ' + expr(node.alias);
      return tableSql;
    }
    if (node.type === 'DerivedTable') {
      var derivedSql = '(' + statement(node.query) + ') AS ' + expr(node.alias);
      if (node.columns && node.columns.length) derivedSql += ' (' + node.columns.map(expr).join(', ') + ')';
      return derivedSql;
    }
    throw new TypeError('Unsupported SQL AST relation node: ' + node.type);
  }

  function renderWith(node) {
    if (!node) return '';
    if (node.type !== 'WithClause' || !Array.isArray(node.entries) || node.entries.length === 0) throw new TypeError('Invalid SQL AST WITH clause');
    return 'WITH' + (node.recursive ? ' RECURSIVE' : '') + ' ' + node.entries.map(function (entry) {
      if (!entry || entry.type !== 'CommonTableExpression') throw new TypeError('Invalid SQL AST common table expression');
      var sql = expr(entry.name);
      if (entry.columns && entry.columns.length) sql += ' (' + entry.columns.map(expr).join(', ') + ')';
      return sql + ' AS (' + statement(entry.query) + ')';
    }).join(', ');
  }

  function renderTail(node) {
    var sql = '';
    if (node.orderBy && node.orderBy.length) {
      sql += ' ORDER BY ' + node.orderBy.map(function (entry) { return expr(entry.expression) + (entry.direction ? ' ' + entry.direction : ''); }).join(', ');
    }
    if (node.limit) sql += ' LIMIT ' + expr(node.limit);
    if (node.offset) sql += ' OFFSET ' + expr(node.offset);
    return sql;
  }

  function hasOperandBoundary(node) {
    return !!(node && (node.type === 'SetOperationStatement' || node.with || (node.orderBy && node.orderBy.length) || node.limit || node.offset));
  }

  function groupedOperand(node) {
    var sql = statement(node);
    if (!hasOperandBoundary(node)) return sql;
    if (dialect !== 'sqlite') return '(' + sql + ')';
    generatedAlias += 1;
    return 'SELECT * FROM (' + sql + ') AS ' + quoteIdentifier(dialect, '__nublox_set_' + generatedAlias);
  }

  function renderSelect(node) {
    var sql = '';
    if (node.with) sql += renderWith(node.with) + ' ';
    sql += 'SELECT ' + (node.distinct ? 'DISTINCT ' : '') + node.columns.map(expr).join(', ');
    if (node.from) sql += ' FROM ' + relation(node.from);
    node.joins.forEach(function (entry) {
      sql += ' ' + entry.kind + ' JOIN ' + relation(entry.source);
      if (entry.condition) sql += ' ON ' + expr(entry.condition);
    });
    if (node.where) sql += ' WHERE ' + expr(node.where);
    if (node.groupBy.length) sql += ' GROUP BY ' + node.groupBy.map(expr).join(', ');
    if (node.having) sql += ' HAVING ' + expr(node.having);
    return sql + renderTail(node);
  }

  function renderSetOperation(node) {
    var sql = '';
    if (node.with) sql += renderWith(node.with) + ' ';
    sql += groupedOperand(node.left) + ' ' + node.operator + (node.all ? ' ALL ' : ' ') + groupedOperand(node.right);
    return sql + renderTail(node);
  }

  function statement(node) {
    if (!node || typeof node !== 'object') throw new TypeError('NuBloxSQL compiler requires a query AST');
    if (node.type === 'SelectStatement') return renderSelect(node);
    if (node.type === 'SetOperationStatement') return renderSetOperation(node);
    throw new TypeError('NuBloxSQL compiler does not support query node: ' + node.type);
  }

  var sql = statement(ast);
  return Object.freeze({ dialect: dialect, sql: sql, targetToSource: Object.freeze(binder.targetToSource.slice()) });
}

exports.compile = compile;
exports.quoteIdentifier = quoteIdentifier;
