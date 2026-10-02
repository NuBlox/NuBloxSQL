'use strict';

var Ast = require('./Ast');
var tokenize = require('./Tokenizer').tokenize;

var PRECEDENCE = Object.freeze({ OR: 1, AND: 2, '=': 3, '<>': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, LIKE: 3, IS: 3, IN: 3, '||': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 });
var CLAUSE_WORDS = Object.freeze({ FROM:1, INNER:1, LEFT:1, RIGHT:1, FULL:1, CROSS:1, JOIN:1, WHERE:1, GROUP:1, HAVING:1, ORDER:1, LIMIT:1, OFFSET:1, ON:1, UNION:1, INTERSECT:1, EXCEPT:1 });

function parserError(token, message) {
  var e = new SyntaxError(message + ' at character ' + token.start);
  e.position = token.start;
  return e;
}

function createParser(sql, dialect) {
  var tokens = tokenize(sql, dialect);
  var p = 0;
  function peek(offset) { return tokens[p + (offset || 0)]; }
  function take() { return tokens[p++]; }
  function is(type, value) { var t = peek(); return t.type === type && (value === undefined || t.value === value); }
  function keyword(value) { return is('keyword', value); }
  function punctuation(value) { return is('punctuation', value); }
  function expect(type, value, message) { var t = peek(); if (!is(type, value)) throw parserError(t, message || ('Expected ' + (value || type))); return take(); }
  function startsQuery() { return keyword('SELECT') || keyword('WITH'); }

  function parseIdentifier() {
    var parts = [];
    var token = peek();
    if (token.type !== 'identifier') throw parserError(token, 'Expected identifier');
    parts.push(take().value);
    while (punctuation('.') && peek(1).type === 'identifier') { take(); parts.push(take().value); }
    return Ast.identifier(parts);
  }

  function parseIdentifierList() {
    var items = [];
    do {
      items.push(parseIdentifier());
      if (!punctuation(',')) break;
      take();
    } while (true);
    return items;
  }

  function parsePrimary() {
    var t = peek();
    if (t.type === 'number') { take(); return Ast.literal(t.value, t.raw); }
    if (t.type === 'string') { take(); return Ast.literal(t.value, t.raw); }
    if (t.type === 'parameter') { take(); return Ast.parameter(t.value, t.raw && t.raw[0] === '$' ? 'numbered-dollar' : t.raw && t.raw[0] !== '?' ? 'named' : 'qmark'); }
    if (keyword('NULL')) { take(); return Ast.literal(null, 'NULL'); }
    if (keyword('TRUE')) { take(); return Ast.literal(true, 'TRUE'); }
    if (keyword('FALSE')) { take(); return Ast.literal(false, 'FALSE'); }
    if (keyword('EXISTS')) {
      take();
      expect('punctuation', '(', 'Expected ( after EXISTS');
      if (!startsQuery()) throw parserError(peek(), 'EXISTS requires a SELECT query');
      var existsQuery = parseQuery();
      expect('punctuation', ')', 'Expected ) after EXISTS subquery');
      return Ast.exists(existsQuery);
    }
    if (is('operator', '*')) { take(); return Ast.wildcard(null); }
    if (punctuation('(')) {
      take();
      if (startsQuery()) {
        var query = parseQuery();
        expect('punctuation', ')', 'Expected closing subquery parenthesis');
        return Ast.subquery(query);
      }
      var nested = parseExpression(0);
      expect('punctuation', ')', 'Expected closing parenthesis');
      return nested;
    }
    if (t.type === 'identifier') {
      var id = parseIdentifier();
      if (punctuation('(')) {
        take(); var args = [];
        if (!punctuation(')')) {
          do { args.push(parseExpression(0)); if (!punctuation(',')) break; take(); } while (true);
        }
        expect('punctuation', ')', 'Expected closing function parenthesis');
        return Ast.call(id, args);
      }
      if (punctuation('.') && peek(1).type === 'operator' && peek(1).value === '*') { take(); take(); return Ast.wildcard(id); }
      return id;
    }
    throw parserError(t, 'Unsupported SQL expression');
  }

  function parseUnary() {
    if (keyword('NOT')) { take(); return Ast.unary('NOT', parseUnary()); }
    if (is('operator', '+') || is('operator', '-')) { var op = take().value; return Ast.unary(op, parseUnary()); }
    return parsePrimary();
  }

  function currentBinaryOperator() {
    var t = peek();
    if (t.type === 'operator' && PRECEDENCE[t.value]) return t.value;
    if (t.type === 'keyword' && PRECEDENCE[t.value]) return t.value;
    return null;
  }

  function parseExpression(minPrecedence) {
    var left = parseUnary();
    while (true) {
      var op = currentBinaryOperator();
      if (!op || PRECEDENCE[op] < minPrecedence) break;
      take();
      if (op === 'IS' && keyword('NOT')) { take(); op = 'IS NOT'; }
      if (op === 'IN') {
        expect('punctuation', '(', 'Expected ( after IN');
        if (startsQuery()) {
          var inQuery = parseQuery();
          expect('punctuation', ')', 'Expected ) after IN subquery');
          left = Ast.binary(op, left, Ast.subquery(inQuery));
          continue;
        }
        var items = [];
        if (!punctuation(')')) {
          do { items.push(parseExpression(0)); if (!punctuation(',')) break; take(); } while (true);
        }
        expect('punctuation', ')', 'Expected ) after IN list');
        left = Ast.binary(op, left, { type: 'ListExpression', items: items });
        continue;
      }
      var right = parseExpression(PRECEDENCE[op === 'IS NOT' ? 'IS' : op] + 1);
      left = Ast.binary(op, left, right);
    }
    return left;
  }

  function parseAliasExpression() {
    var expression = parseExpression(0);
    if (keyword('AS')) { take(); return Ast.alias(expression, parseIdentifier()); }
    if (peek().type === 'identifier' && !CLAUSE_WORDS[String(peek().value).toUpperCase()]) return Ast.alias(expression, parseIdentifier());
    return expression;
  }

  function parseExpressionList(itemParser) {
    var items = [];
    do { items.push((itemParser || parseExpression)(0)); if (!punctuation(',')) break; take(); } while (true);
    return items;
  }

  function parseRelationAlias(required) {
    var aliasName = null;
    if (keyword('AS')) { take(); aliasName = parseIdentifier(); }
    else if (peek().type === 'identifier') aliasName = parseIdentifier();
    if (required && !aliasName) throw parserError(peek(), 'Derived table requires an alias');
    return aliasName;
  }

  function parseTableReference() {
    if (punctuation('(')) {
      take();
      if (!startsQuery()) throw parserError(peek(), 'Derived table requires a SELECT query');
      var query = parseQuery();
      expect('punctuation', ')', 'Expected closing derived-table parenthesis');
      var derivedAlias = parseRelationAlias(true);
      var columns = [];
      if (punctuation('(')) {
        take(); columns = parseIdentifierList(); expect('punctuation', ')', 'Expected ) after derived-table column aliases');
      }
      return Ast.derivedTable(query, derivedAlias, columns);
    }
    var name = parseIdentifier();
    return Ast.table(name, parseRelationAlias(false));
  }

  function parseJoin() {
    var kind = 'INNER';
    if (keyword('INNER') || keyword('LEFT') || keyword('RIGHT') || keyword('FULL') || keyword('CROSS')) kind = take().value;
    if (keyword('OUTER')) take();
    expect('keyword', 'JOIN', 'Expected JOIN');
    var source = parseTableReference();
    var condition = null;
    if (kind !== 'CROSS') { expect('keyword', 'ON', 'Expected ON join condition'); condition = parseExpression(0); }
    return Ast.join(kind, source, condition);
  }

  function parseWithClause() {
    expect('keyword', 'WITH', 'Expected WITH');
    var recursive = false;
    if (keyword('RECURSIVE')) { take(); recursive = true; }
    var entries = [];
    do {
      var name = parseIdentifier();
      var columns = [];
      if (punctuation('(')) {
        take(); columns = parseIdentifierList(); expect('punctuation', ')', 'Expected ) after CTE column list');
      }
      expect('keyword', 'AS', 'Expected AS in CTE');
      expect('punctuation', '(', 'Expected ( before CTE query');
      if (!startsQuery()) throw parserError(peek(), 'CTE requires a SELECT query');
      var query = parseQuery();
      expect('punctuation', ')', 'Expected ) after CTE query');
      entries.push(Ast.commonTableExpression(name, columns, query));
      if (!punctuation(',')) break;
      take();
    } while (true);
    return Ast.withClause(recursive, entries);
  }

  function parseSelect(withNode) {
    expect('keyword', 'SELECT', 'Expected SELECT statement');
    var distinct = false; if (keyword('DISTINCT')) { distinct = true; take(); }
    var columns = parseExpressionList(parseAliasExpression);
    var from = null; var joins = []; var where = null; var groupBy = []; var having = null; var orderBy = []; var limit = null; var offset = null;
    if (keyword('FROM')) { take(); from = parseTableReference(); }
    while (keyword('JOIN') || keyword('INNER') || keyword('LEFT') || keyword('RIGHT') || keyword('FULL') || keyword('CROSS')) joins.push(parseJoin());
    if (keyword('WHERE')) { take(); where = parseExpression(0); }
    if (keyword('GROUP')) { take(); expect('keyword', 'BY', 'Expected BY after GROUP'); groupBy = parseExpressionList(); }
    if (keyword('HAVING')) { take(); having = parseExpression(0); }
    if (keyword('ORDER')) {
      take(); expect('keyword', 'BY', 'Expected BY after ORDER');
      do {
        var expression = parseExpression(0); var direction = null;
        if (keyword('ASC') || keyword('DESC')) direction = take().value;
        orderBy.push(Ast.order(expression, direction));
        if (!punctuation(',')) break; take();
      } while (true);
    }
    if (keyword('LIMIT')) { take(); limit = parseExpression(0); }
    if (keyword('OFFSET')) { take(); offset = parseExpression(0); }
    return Ast.selectStatement({ with: withNode, distinct: distinct, columns: columns, from: from, joins: joins, where: where, groupBy: groupBy, having: having, orderBy: orderBy, limit: limit, offset: offset });
  }

  function parseQuery() {
    var withNode = null;
    if (keyword('WITH')) withNode = parseWithClause();
    if (!keyword('SELECT')) throw parserError(peek(), 'Only SELECT query bodies are supported by the current compiler');
    return parseSelect(withNode);
  }

  function parseRoot() {
    var statement = parseQuery();
    if (punctuation(';')) take();
    expect('eof', undefined, 'Unexpected trailing SQL');
    return statement;
  }

  return { parse: parseRoot };
}

function parse(sql, dialect, core) {
  var ast = createParser(sql, dialect).parse();
  return core ? core.deepFreeze(ast) : ast;
}

exports.parse = parse;
