'use strict';

var KEYWORDS = Object.freeze({
  SELECT: true, DISTINCT: true, FROM: true, AS: true, INNER: true, LEFT: true, RIGHT: true, FULL: true, OUTER: true,
  CROSS: true, JOIN: true, ON: true, WHERE: true, GROUP: true, BY: true, HAVING: true, ORDER: true, ASC: true, DESC: true,
  LIMIT: true, OFFSET: true, AND: true, OR: true, NOT: true, IS: true, NULL: true, TRUE: true, FALSE: true, LIKE: true, IN: true
});

function error(message, index) {
  var e = new SyntaxError(message + ' at character ' + index);
  e.position = index;
  return e;
}
function isSpace(ch) { return /\s/.test(ch || ''); }
function isStart(ch) { return /[A-Za-z_]/.test(ch || ''); }
function isPart(ch) { return /[A-Za-z0-9_$]/.test(ch || ''); }
function isDigit(ch) { return /[0-9]/.test(ch || ''); }

function tokenize(sql, dialect) {
  if (typeof sql !== 'string') throw new TypeError('SQL parser requires a SQL string');
  var tokens = [];
  var i = 0;
  var qmarkIndex = 0;
  var sqliteIndex = 0;
  var sqliteNames = Object.create(null);

  function push(type, value, raw, start) { tokens.push({ type: type, value: value, raw: raw, start: start, end: i }); }

  while (i < sql.length) {
    var ch = sql[i];
    var start = i;
    if (isSpace(ch)) { i += 1; continue; }

    if (ch === '-' && sql[i + 1] === '-') { i += 2; while (i < sql.length && sql[i] !== '\n') i += 1; continue; }
    if (dialect === 'mysql' && ch === '#') { i += 1; while (i < sql.length && sql[i] !== '\n') i += 1; continue; }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      if (i >= sql.length) throw error('Unterminated SQL block comment', start);
      i += 2; continue;
    }

    if (ch === "'") {
      i += 1; var value = '';
      while (i < sql.length) {
        ch = sql[i];
        if (ch === "'") {
          if (sql[i + 1] === "'") { value += "'"; i += 2; continue; }
          i += 1; break;
        }
        if (dialect === 'mysql' && ch === '\\' && i + 1 < sql.length) { value += sql[i + 1]; i += 2; continue; }
        value += ch; i += 1;
      }
      if (sql[i - 1] !== "'") throw error('Unterminated SQL string', start);
      push('string', value, sql.slice(start, i), start); continue;
    }

    if (ch === '"' || (dialect === 'mysql' && ch === '`')) {
      var quote = ch; i += 1; var ident = '';
      while (i < sql.length) {
        ch = sql[i];
        if (ch === quote) {
          if (sql[i + 1] === quote) { ident += quote; i += 2; continue; }
          i += 1; break;
        }
        ident += ch; i += 1;
      }
      if (sql[i - 1] !== quote) throw error('Unterminated quoted identifier', start);
      push('identifier', ident, sql.slice(start, i), start); continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(sql[i + 1]))) {
      i += 1;
      while (isDigit(sql[i])) i += 1;
      if (sql[i] === '.') { i += 1; while (isDigit(sql[i])) i += 1; }
      if (sql[i] === 'e' || sql[i] === 'E') {
        i += 1; if (sql[i] === '+' || sql[i] === '-') i += 1;
        if (!isDigit(sql[i])) throw error('Invalid numeric exponent', i);
        while (isDigit(sql[i])) i += 1;
      }
      var rawNum = sql.slice(start, i);
      push('number', Number(rawNum), rawNum, start); continue;
    }

    if (dialect === 'postgresql' && ch === '$' && isDigit(sql[i + 1])) {
      i += 1; while (isDigit(sql[i])) i += 1;
      var pgIndex = Number(sql.slice(start + 1, i));
      if (!Number.isSafeInteger(pgIndex) || pgIndex < 1) throw error('Invalid PostgreSQL parameter marker', start);
      push('parameter', pgIndex, sql.slice(start, i), start); continue;
    }
    if ((dialect === 'mysql' || dialect === 'sqlite') && ch === '?') {
      i += 1;
      if (dialect === 'sqlite') {
        var digitsStart = i; while (isDigit(sql[i])) i += 1;
        var explicit = i > digitsStart ? Number(sql.slice(digitsStart, i)) : null;
        if (explicit !== null) { if (explicit < 1) throw error('Invalid SQLite parameter marker', start); sqliteIndex = Math.max(sqliteIndex, explicit); push('parameter', explicit, sql.slice(start, i), start); }
        else { sqliteIndex += 1; push('parameter', sqliteIndex, '?', start); }
      } else { qmarkIndex += 1; push('parameter', qmarkIndex, '?', start); }
      continue;
    }
    if (dialect === 'sqlite' && (ch === ':' || ch === '@' || ch === '$') && isStart(sql[i + 1])) {
      i += 1; while (isPart(sql[i])) i += 1;
      var name = sql.slice(start, i);
      if (!sqliteNames[name]) { sqliteIndex += 1; sqliteNames[name] = sqliteIndex; }
      push('parameter', name, name, start); continue;
    }

    if (isStart(ch)) {
      i += 1; while (isPart(sql[i])) i += 1;
      var word = sql.slice(start, i); var upper = word.toUpperCase();
      push(KEYWORDS[upper] ? 'keyword' : 'identifier', KEYWORDS[upper] ? upper : word, word, start); continue;
    }

    var two = sql.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=' || two === '||') { i += 2; push('operator', two, two, start); continue; }
    if ('=<>+-*/%,().;'.indexOf(ch) !== -1) {
      i += 1;
      var type = '(),.;'.indexOf(ch) !== -1 ? 'punctuation' : 'operator';
      push(type, ch, ch, start); continue;
    }
    throw error('Unsupported SQL token ' + JSON.stringify(ch), start);
  }
  tokens.push({ type: 'eof', value: null, raw: '', start: i, end: i });
  return tokens;
}

exports.KEYWORDS = KEYWORDS;
exports.tokenize = tokenize;
