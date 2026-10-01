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
    throw new TypeError('Unsupported SQL AST expression node: ' + node.type);
  }

  function table(node) {
    var sql = expr(node.name);
    if (node.alias) sql += ' AS ' + expr(node.alias);
    return sql;
  }

  function statement(node) {
    if (!node || node.type !== 'SelectStatement') throw new TypeError('M8 compiler currently supports SelectStatement only');
    var sql = 'SELECT ' + (node.distinct ? 'DISTINCT ' : '') + node.columns.map(expr).join(', ');
    if (node.from) sql += ' FROM ' + table(node.from);
    node.joins.forEach(function (entry) {
      sql += ' ' + entry.kind + ' JOIN ' + table(entry.source);
      if (entry.condition) sql += ' ON ' + expr(entry.condition);
    });
    if (node.where) sql += ' WHERE ' + expr(node.where);
    if (node.groupBy.length) sql += ' GROUP BY ' + node.groupBy.map(expr).join(', ');
    if (node.having) sql += ' HAVING ' + expr(node.having);
    if (node.orderBy.length) {
      sql += ' ORDER BY ' + node.orderBy.map(function (entry) { return expr(entry.expression) + (entry.direction ? ' ' + entry.direction : ''); }).join(', ');
    }
    if (node.limit) sql += ' LIMIT ' + expr(node.limit);
    if (node.offset) sql += ' OFFSET ' + expr(node.offset);
    return sql;
  }

  var sql = statement(ast);
  return Object.freeze({ dialect: dialect, sql: sql, targetToSource: Object.freeze(binder.targetToSource.slice()) });
}

exports.compile = compile;
exports.quoteIdentifier = quoteIdentifier;
