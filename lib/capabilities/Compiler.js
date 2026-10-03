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

  function typeSql(node) {
    if (!node || node.type !== 'TypeName' || typeof node.name !== 'string') throw new TypeError('Invalid SQL AST type name');
    if (!/^[A-Z][A-Z0-9_ ]*$/.test(node.name)) throw new TypeError('Unsupported SQL CAST type: ' + node.name);
    var sql = node.name;
    if (node.modifiers && node.modifiers.length) {
      node.modifiers.forEach(function (modifier) {
        if (!Number.isSafeInteger(modifier) || modifier < 0) throw new TypeError('Invalid SQL CAST type modifier');
      });
      sql += '(' + node.modifiers.join(', ') + ')';
    }
    return sql;
  }

  function frameBoundSql(node) {
    if (!node || node.type !== 'WindowFrameBound') throw new TypeError('Invalid SQL AST window frame bound');
    if (node.kind === 'UNBOUNDED PRECEDING' || node.kind === 'UNBOUNDED FOLLOWING' || node.kind === 'CURRENT ROW') return node.kind;
    if (node.kind === 'VALUE PRECEDING') return expr(node.value) + ' PRECEDING';
    if (node.kind === 'VALUE FOLLOWING') return expr(node.value) + ' FOLLOWING';
    throw new TypeError('Unsupported SQL window frame bound: ' + node.kind);
  }

  function orderSql(entry) {
    if (!entry || entry.type !== 'OrderExpression') throw new TypeError('Invalid SQL AST ORDER BY expression');
    return expr(entry.expression) + (entry.direction ? ' ' + entry.direction : '');
  }

  function windowSpecificationSql(node) {
    if (!node || node.type !== 'WindowSpecification') throw new TypeError('Invalid SQL AST window specification');
    var parts = [];
    if (node.base) parts.push(expr(node.base));
    if (node.partitionBy && node.partitionBy.length) parts.push('PARTITION BY ' + node.partitionBy.map(expr).join(', '));
    if (node.orderBy && node.orderBy.length) parts.push('ORDER BY ' + node.orderBy.map(orderSql).join(', '));
    if (node.frame) {
      var frame = node.frame;
      if (['ROWS', 'RANGE', 'GROUPS'].indexOf(frame.unit) === -1) throw new TypeError('Unsupported SQL window frame unit: ' + frame.unit);
      var frameSql = frame.unit + ' ';
      if (frame.end) frameSql += 'BETWEEN ' + frameBoundSql(frame.start) + ' AND ' + frameBoundSql(frame.end);
      else frameSql += frameBoundSql(frame.start);
      if (frame.exclude) frameSql += ' EXCLUDE ' + frame.exclude;
      parts.push(frameSql);
    }
    return parts.join(' ');
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
    if (node.type === 'BetweenExpression') return '(' + expr(node.expression) + (node.not ? ' NOT' : '') + ' BETWEEN ' + expr(node.lower) + ' AND ' + expr(node.upper) + ')';
    if (node.type === 'ListExpression') return '(' + node.items.map(expr).join(', ') + ')';
    if (node.type === 'CastExpression') return 'CAST(' + expr(node.expression) + ' AS ' + typeSql(node.targetType) + ')';
    if (node.type === 'CaseExpression') {
      var caseSql = 'CASE';
      if (node.operand) caseSql += ' ' + expr(node.operand);
      node.branches.forEach(function (branch) { caseSql += ' WHEN ' + expr(branch.when) + ' THEN ' + expr(branch.then); });
      if (node.else) caseSql += ' ELSE ' + expr(node.else);
      return caseSql + ' END';
    }
    if (node.type === 'WindowExpression') {
      var over = node.over;
      if (over.type === 'WindowReference') return expr(node.expression) + ' OVER ' + expr(over.name);
      return expr(node.expression) + ' OVER (' + windowSpecificationSql(over) + ')';
    }
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

  function renderWindows(entries) {
    if (!entries || !entries.length) return '';
    return ' WINDOW ' + entries.map(function (entry) {
      if (!entry || entry.type !== 'WindowDefinition') throw new TypeError('Invalid SQL AST WINDOW definition');
      return expr(entry.name) + ' AS (' + windowSpecificationSql(entry.specification) + ')';
    }).join(', ');
  }

  function renderTail(node) {
    var sql = '';
    if (node.orderBy && node.orderBy.length) sql += ' ORDER BY ' + node.orderBy.map(orderSql).join(', ');
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
    sql += renderWindows(node.windows);
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
