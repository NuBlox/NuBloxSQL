'use strict';

// Internal recurrence calculator. No filesystem access, timers or database writes.
const jobs = require('./JobKernel');

const MINUTE = 60000;
const DAY = 86400000;

function instant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
    throw new TypeError(label + ' must be a UTC ISO-8601 timestamp');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== new Date(value).toISOString()) {
    throw new TypeError(label + ' must be a valid UTC timestamp');
  }
  return time;
}

function validate(recurrence) {
  if (!recurrence || typeof recurrence !== 'object' || Array.isArray(recurrence)) {
    throw new TypeError('schedule recurrence must be an object');
  }
  const value = jobs.safeCopy(recurrence);
  if (value.kind === 'interval') {
    if (Object.keys(value).sort().join(',') !== 'anchorAt,everyMinutes,kind' ||
        !Number.isSafeInteger(value.everyMinutes) || value.everyMinutes < 1 ||
        value.everyMinutes > 10080) {
      throw new TypeError('interval recurrence requires anchorAt and everyMinutes (1..10080)');
    }
    instant(value.anchorAt, 'interval anchorAt');
  } else if (value.kind === 'daily') {
    if (Object.keys(value).sort().join(',') !== 'at,kind,timeZone' ||
        typeof value.at !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.at) ||
        typeof value.timeZone !== 'string') {
      throw new TypeError('daily recurrence requires at HH:MM and an IANA timeZone');
    }
    try {
      new Intl.DateTimeFormat('en-GB', {timeZone: value.timeZone}).format(new Date());
    } catch (_) {
      throw new TypeError('daily recurrence requires a valid IANA timeZone');
    }
  } else {
    throw new TypeError('unsupported recurrence kind');
  }
  return value;
}

const formatters = new Map();
function parts(timestamp, zone) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    formatters.set(zone, formatter);
  }
  const record = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter(p => ['year','month','day','hour','minute'].includes(p.type))
    .map(p => [p.type, Number(p.value)]));
  return record;
}

function datesOfLocalDay(date, hh, mm, zone) {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hh, mm);
  const matches = new Set();
  // Probe all offsets surrounding DST transitions, including unusual timezones.
  for (const hours of [-36, -18, 0, 18, 36]) {
    const probe = naive + hours * 3600000;
    const local = parts(probe, zone);
    const localAsUtc = Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute);
    const offsetMs = localAsUtc - Math.floor(probe / MINUTE) * MINUTE;
    const candidate = naive - offsetMs;
    const observed = parts(candidate, zone);
    if (observed.year === date.year && observed.month === date.month &&
        observed.day === date.day && observed.hour === hh && observed.minute === mm) {
      matches.add(candidate);
    }
  }
  return [...matches].sort((a,b) => a-b);
}

function dayAt(date, delta) {
  const d = new Date(Date.UTC(date.year, date.month-1, date.day + delta));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}

function dailyInstant(date, recurrence) {
  const [hh, mm] = recurrence.at.split(':').map(Number);
  // First occurrence on fall-back days; skip nonexistent times in spring.
  return datesOfLocalDay(date,hh,mm,recurrence.timeZone)[0] ?? null;
}

function nextAfter(input, afterMs) {
  const recurrence = validate(input);
  if (!Number.isSafeInteger(afterMs)) throw new TypeError('afterMs must be an epoch millisecond integer');
  if (recurrence.kind === 'interval') {
    const anchor = instant(recurrence.anchorAt, 'interval anchorAt');
    const duration = recurrence.everyMinutes * MINUTE;
    if (afterMs < anchor) return anchor;
    return anchor + (Math.floor((afterMs - anchor) / duration) + 1) * duration;
  }
  const local = parts(afterMs, recurrence.timeZone);
  for (let offset = 0; offset < 5; offset++) {
    const value = dailyInstant(dayAt(local,offset), recurrence);
    if (value !== null && value > afterMs) return value;
  }
  throw new Error('unable to calculate next daily schedule occurrence');
}

function previousAtOrBefore(input, atMs) {
  const recurrence = validate(input);
  if (!Number.isSafeInteger(atMs)) throw new TypeError('atMs must be an epoch millisecond integer');
  if (recurrence.kind === 'interval') {
    const anchor = instant(recurrence.anchorAt, 'interval anchorAt');
    const duration = recurrence.everyMinutes * MINUTE;
    return atMs < anchor ? null : anchor + Math.floor((atMs-anchor)/duration)*duration;
  }
  const local = parts(atMs, recurrence.timeZone);
  for (let offset = 0; offset >= -4; offset--) {
    const value = dailyInstant(dayAt(local, offset), recurrence);
    if (value !== null && value <= atMs) return value;
  }
  throw new Error('unable to calculate previous daily schedule occurrence');
}

module.exports = Object.freeze({ validate, instant, nextAfter, previousAtOrBefore });
