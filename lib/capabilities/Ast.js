'use strict';

function identifier(parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new TypeError('SQL AST identifier requires at least one part');
  return { type: 'Identifier', parts: parts.slice() };
}
function literal(value, raw) { return { type: 'Literal', value: value, raw: raw === undefined ? null : raw }; }
function parameter(binding, style) { return { type: 'Parameter', binding: binding, style: style || null }; }
function wildcard(qualifier) { return { type: 'Wildcard', qualifier: qualifier || null }; }
function call(name, args) { return { type: 'CallExpression', name: name, arguments: (args || []).slice() }; }
function unary(operator, argument) { return { type: 'UnaryExpression', operator: operator, argument: argument }; }
function binary(operator, left, right) { return { type: 'BinaryExpression', operator: operator, left: left, right: right }; }
function alias(expression, name) { return { type: 'AliasedExpression', expression: expression, alias: name }; }
function order(expression, direction) { return { type: 'OrderExpression', expression: expression, direction: direction || null }; }
function table(name, aliasName) { return { type: 'TableReference', name: name, alias: aliasName || null }; }
function join(kind, source, condition) { return { type: 'Join', kind: kind, source: source, condition: condition || null }; }
function selectStatement(options) {
  options = options || {};
  return {
    type: 'SelectStatement',
    distinct: !!options.distinct,
    columns: (options.columns || []).slice(),
    from: options.from || null,
    joins: (options.joins || []).slice(),
    where: options.where || null,
    groupBy: (options.groupBy || []).slice(),
    having: options.having || null,
    orderBy: (options.orderBy || []).slice(),
    limit: options.limit || null,
    offset: options.offset || null
  };
}

exports.identifier = identifier;
exports.literal = literal;
exports.parameter = parameter;
exports.wildcard = wildcard;
exports.call = call;
exports.unary = unary;
exports.binary = binary;
exports.alias = alias;
exports.order = order;
exports.table = table;
exports.join = join;
exports.selectStatement = selectStatement;
