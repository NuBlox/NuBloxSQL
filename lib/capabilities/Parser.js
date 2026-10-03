'use strict';

var Ast = require('./Ast');
var tokenize = require('./Tokenizer').tokenize;

var PRECEDENCE = Object.freeze({ OR: 1, AND: 2, '=': 3, '<>': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, LIKE: 3, IS: 3, IN: 3, BETWEEN: 3, '||': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 });
var CLAUSE_WORDS = Object.freeze({ FROM:1, INNER:1, LEFT:1, RIGHT:1, FULL:1, CROSS:1, JOIN:1, WHERE:1, GROUP:1, HAVING:1, WINDOW:1, ORDER:1, LIMIT:1, OFFSET:1, ON:1, UNION:1, INTERSECT:1, EXCEPT:1 });
var FRAME_UNITS = Object.freeze({ ROWS: true, RANGE: true, GROUPS: true });

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
  function operator(value) { return is('operator', value); }
  function expect(type, value, message) { var t = peek(); if (!is(type, value)) throw parserError(t, message || ('Expected ' + (value || type))); return take(); }
  function startsQuery() { return keyword('SELECT') || keyword('WITH'); }
  function setOperator() { return keyword('UNION') || keyword('INTERSECT') || keyword('EXCEPT') ? peek().value : null; }
  function setPrecedence(value) {
    if (dialect === 'sqlite') return 1;
    return value === 'INTERSECT' ? 2 : 1;
  }

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

  function parseTypeName() {
    var first = peek();
    if (first.type !== 'identifier') throw parserError(first, 'Expected SQL type name');
    var words = [String(take().value).toUpperCase()];
    if (peek().type === 'identifier') {
      var pair = words[0] + ' ' + String(peek().value).toUpperCase();
      if (pair === 'DOUBLE PRECISION' || pair === 'CHARACTER VARYING') words.push(String(take().value).toUpperCase());
    }
    var modifiers = [];
    if (punctuation('(')) {
      take();
      do {
        var number = expect('number', undefined, 'SQL type modifier must be numeric');
        if (!Number.isSafeInteger(number.value) || number.value < 0) throw parserError(number, 'SQL type modifier must be a non-negative integer');
        modifiers.push(number.value);
        if (!punctuation(',')) break;
        take();
      } while (true);
      expect('punctuation', ')', 'Expected ) after SQL type modifiers');
    }
    return Ast.typeName(words.join(' '), modifiers);
  }

  function parseCaseExpression() {
    expect('keyword', 'CASE', 'Expected CASE');
    var operand = null;
    if (!keyword('WHEN')) operand = parseExpression(0);
    var branches = [];
    while (keyword('WHEN')) {
      take();
      var when = parseExpression(0);
      expect('keyword', 'THEN', 'Expected THEN in CASE expression');
      var then = parseExpression(0);
      branches.push(Ast.caseBranch(when, then));
    }
    if (branches.length === 0) throw parserError(peek(), 'CASE requires at least one WHEN branch');
    var otherwise = null;
    if (keyword('ELSE')) { take(); otherwise = parseExpression(0); }
    expect('keyword', 'END', 'Expected END for CASE expression');
    return Ast.caseExpression(operand, branches, otherwise);
  }

  function parseCastExpression() {
    expect('keyword', 'CAST', 'Expected CAST');
    expect('punctuation', '(', 'Expected ( after CAST');
    var expression = parseExpression(0);
    expect('keyword', 'AS', 'Expected AS in CAST expression');
    var targetType = parseTypeName();
    expect('punctuation', ')', 'Expected ) after CAST expression');
    return Ast.cast(expression, targetType, 'CAST');
  }

  function parseFrameBound() {
    if (keyword('UNBOUNDED')) {
      take();
      if (keyword('PRECEDING')) { take(); return Ast.windowFrameBound('UNBOUNDED PRECEDING'); }
      if (keyword('FOLLOWING')) { take(); return Ast.windowFrameBound('UNBOUNDED FOLLOWING'); }
      throw parserError(peek(), 'Expected PRECEDING or FOLLOWING after UNBOUNDED');
    }
    if (keyword('CURRENT')) {
      take(); expect('keyword', 'ROW', 'Expected ROW after CURRENT');
      return Ast.windowFrameBound('CURRENT ROW');
    }
    var value = parseExpression(4);
    if (keyword('PRECEDING')) { take(); return Ast.windowFrameBound('VALUE PRECEDING', value); }
    if (keyword('FOLLOWING')) { take(); return Ast.windowFrameBound('VALUE FOLLOWING', value); }
    throw parserError(peek(), 'Expected PRECEDING or FOLLOWING after window frame offset');
  }

  function parseWindowOrderList() {
    var items = [];
    do {
      var expression = parseExpression(0);
      var direction = null;
      if (keyword('ASC') || keyword('DESC')) direction = take().value;
      items.push(Ast.order(expression, direction));
      if (!punctuation(',')) break;
      take();
    } while (true);
    return items;
  }

  function parseWindowFrame() {
    var unit = take().value;
    var start;
    var end = null;
    if (keyword('BETWEEN')) {
      take();
      start = parseFrameBound();
      expect('keyword', 'AND', 'Expected AND in window frame');
      end = parseFrameBound();
    } else start = parseFrameBound();
    var exclude = null;
    if (keyword('EXCLUDE')) {
      take();
      if (keyword('CURRENT')) { take(); expect('keyword', 'ROW', 'Expected ROW after EXCLUDE CURRENT'); exclude = 'CURRENT ROW'; }
      else if (keyword('GROUP')) { take(); exclude = 'GROUP'; }
      else if (keyword('TIES')) { take(); exclude = 'TIES'; }
      else if (keyword('NO')) { take(); expect('keyword', 'OTHERS', 'Expected OTHERS after EXCLUDE NO'); exclude = 'NO OTHERS'; }
      else throw parserError(peek(), 'Unsupported EXCLUDE clause');
    }
    return Ast.windowFrame(unit, start, end, exclude);
  }

  function parseWindowSpecification() {
    var base = null;
    var partitionBy = [];
    var orderBy = [];
    var frame = null;
    if (peek().type === 'identifier') base = parseIdentifier();
    if (keyword('PARTITION')) {
      take(); expect('keyword', 'BY', 'Expected BY after PARTITION');
      partitionBy = parseExpressionList();
    }
    if (keyword('ORDER')) {
      take(); expect('keyword', 'BY', 'Expected BY after ORDER');
      orderBy = parseWindowOrderList();
    }
    if (keyword('ROWS') || keyword('RANGE') || keyword('GROUPS')) frame = parseWindowFrame();
    return Ast.windowSpecification(base, partitionBy, orderBy, frame);
  }

  function parseWindowOver() {
    expect('keyword', 'OVER', 'Expected OVER');
    if (peek().type === 'identifier') return Ast.windowReference(parseIdentifier());
    expect('punctuation', '(', 'Expected window name or ( after OVER');
    var specification = parseWindowSpecification();
    expect('punctuation', ')', 'Expected ) after window specification');
    return specification;
  }

  function parsePrimary() {
    var t = peek();
    if (t.type === 'number') { take(); return Ast.literal(t.value, t.raw); }
    if (t.type === 'string') { take(); return Ast.literal(t.value, t.raw); }
    if (t.type === 'parameter') { take(); return Ast.parameter(t.value, t.raw && t.raw[0] === '$' ? 'numbered-dollar' : t.raw && t.raw[0] !== '?' ? 'named' : 'qmark'); }
    if (keyword('NULL')) { take(); return Ast.literal(null, 'NULL'); }
    if (keyword('TRUE')) { take(); return Ast.literal(true, 'TRUE'); }
    if (keyword('FALSE')) { take(); return Ast.literal(false, 'FALSE'); }
    if (keyword('CASE')) return parseCaseExpression();
    if (keyword('CAST')) return parseCastExpression();
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

  function parsePostfix() {
    var value = parsePrimary();
    while (true) {
      if (operator('::')) {
        take(); value = Ast.cast(value, parseTypeName(), '::'); continue;
      }
      if (keyword('OVER')) {
        if (value.type !== 'CallExpression') throw parserError(peek(), 'OVER requires a function call');
        value = Ast.windowExpression(value, parseWindowOver()); continue;
      }
      break;
    }
    return value;
  }

  function parseUnary() {
    if (keyword('NOT')) { take(); return Ast.unary('NOT', parseUnary()); }
    if (is('operator', '+') || is('operator', '-')) { var op = take().value; return Ast.unary(op, parseUnary()); }
    return parsePostfix();
  }

  function currentBinaryOperator() {
    var t = peek();
    if (t.type === 'operator' && PRECEDENCE[t.value]) return { operator: t.value, tokens: 1 };
    if (t.type === 'keyword' && PRECEDENCE[t.value]) return { operator: t.value, tokens: 1 };
    if (keyword('NOT') && peek(1).type === 'keyword' && (peek(1).value === 'IN' || peek(1).value === 'LIKE' || peek(1).value === 'BETWEEN')) {
      return { operator: 'NOT ' + peek(1).value, tokens: 2 };
    }
    return null;
  }

  function parseExpression(minPrecedence) {
    var left = parseUnary();
    while (true) {
      var current = currentBinaryOperator();
      if (!current) break;
      var baseOperator = current.operator.indexOf('NOT ') === 0 ? current.operator.slice(4) : current.operator;
      var precedence = PRECEDENCE[baseOperator];
      if (!precedence || precedence < minPrecedence) break;
      for (var consumed = 0; consumed < current.tokens; consumed += 1) take();
      var op = current.operator;
      if (op === 'IS' && keyword('NOT')) { take(); op = 'IS NOT'; }
      if (baseOperator === 'BETWEEN') {
        var lower = parseExpression(precedence + 1);
        expect('keyword', 'AND', 'Expected AND in BETWEEN expression');
        var upper = parseExpression(precedence + 1);
        left = Ast.between(left, lower, upper, op.indexOf('NOT ') === 0);
        continue;
      }
      if (baseOperator === 'IN') {
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
      var right = parseExpression(precedence + 1);
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

  function parseWindowClause() {
    var definitions = [];
    expect('keyword', 'WINDOW', 'Expected WINDOW');
    do {
      var name = parseIdentifier();
      expect('keyword', 'AS', 'Expected AS in WINDOW definition');
      expect('punctuation', '(', 'Expected ( before WINDOW specification');
      var specification = parseWindowSpecification();
      expect('punctuation', ')', 'Expected ) after WINDOW specification');
      definitions.push(Ast.windowDefinition(name, specification));
      if (!punctuation(',')) break;
      take();
    } while (true);
    return definitions;
  }

  function parseSelectCore() {
    expect('keyword', 'SELECT', 'Expected SELECT statement');
    var distinct = false; if (keyword('DISTINCT')) { distinct = true; take(); }
    var columns = parseExpressionList(parseAliasExpression);
    var from = null; var joins = []; var where = null; var groupBy = []; var having = null; var windows = [];
    if (keyword('FROM')) { take(); from = parseTableReference(); }
    while (keyword('JOIN') || keyword('INNER') || keyword('LEFT') || keyword('RIGHT') || keyword('FULL') || keyword('CROSS')) joins.push(parseJoin());
    if (keyword('WHERE')) { take(); where = parseExpression(0); }
    if (keyword('GROUP')) { take(); expect('keyword', 'BY', 'Expected BY after GROUP'); groupBy = parseExpressionList(); }
    if (keyword('HAVING')) { take(); having = parseExpression(0); }
    if (keyword('WINDOW')) windows = parseWindowClause();
    return Ast.selectStatement({ distinct: distinct, columns: columns, from: from, joins: joins, where: where, groupBy: groupBy, having: having, windows: windows });
  }

  function parseSetPrimary() {
    if (punctuation('(')) {
      take();
      if (!startsQuery()) throw parserError(peek(), 'Parenthesized query requires SELECT or WITH');
      var grouped = parseQuery();
      expect('punctuation', ')', 'Expected closing query parenthesis');
      return grouped;
    }
    if (!keyword('SELECT')) throw parserError(peek(), 'Only SELECT query bodies are supported by the current compiler');
    return parseSelectCore();
  }

  function parseSetExpression(minPrecedence) {
    var left = parseSetPrimary();
    while (true) {
      var value = setOperator();
      if (!value) break;
      var precedence = setPrecedence(value);
      if (precedence < minPrecedence) break;
      take();
      var all = false;
      if (keyword('ALL')) { all = true; take(); }
      else if (keyword('DISTINCT')) take();
      var right = parseSetExpression(precedence + 1);
      left = Ast.setOperation(left, value, all, right);
    }
    return left;
  }

  function parseQueryTail(query, withNode) {
    var orderBy = []; var limit = null; var offset = null;
    if (keyword('ORDER')) {
      take(); expect('keyword', 'BY', 'Expected BY after ORDER');
      orderBy = parseWindowOrderList();
    }
    if (keyword('LIMIT')) { take(); limit = parseExpression(0); }
    if (keyword('OFFSET')) { take(); offset = parseExpression(0); }
    query.with = withNode || null;
    query.orderBy = orderBy;
    query.limit = limit;
    query.offset = offset;
    return query;
  }

  function parseQuery() {
    var withNode = null;
    if (keyword('WITH')) withNode = parseWithClause();
    var query = parseSetExpression(1);
    return parseQueryTail(query, withNode);
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
