/** Independent, dependency-free metric helpers for reproducible test fixtures. */
export function integerOption(value,{name,min,max}){
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}
export function quantile(sorted,p){
  if(!Array.isArray(sorted)||!sorted.length)return null;
  if(!Number.isFinite(p)||p<0||p>1)throw new RangeError('Invalid quantile');
  return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
}
export function summarize(samples,elapsedMs){
  if(!Array.isArray(samples)||samples.some(n=>!Number.isFinite(n)||n<0))
    throw new TypeError('Invalid duration samples');
  if(!Number.isFinite(elapsedMs)||elapsedMs<=0)
    throw new RangeError('Elapsed milliseconds must be positive');
  const sorted=[...samples].sort((a,b)=>a-b);
  const round=n=>n===null?null:Math.round(n*1000)/1000;
  return Object.freeze({
    count:sorted.length,
    elapsedMs:round(elapsedMs),
    operationsPerSecond:round(sorted.length*1000/elapsedMs),
    minMs:round(sorted[0]??null),
    p50Ms:round(quantile(sorted,.50)),
    p95Ms:round(quantile(sorted,.95)),
    p99Ms:round(quantile(sorted,.99)),
    maxMs:round(sorted.at(-1)??null)
  });
}
export function parseArgs(argv,mode){
  if(!['benchmark','soak'].includes(mode))throw new Error('Unknown qualification mode');
  const allowed=new Set(['iterations','concurrency','durationMs','fetchSize','cursorRows']);
  const args={};
  for(const arg of argv){
    const match=/^--([A-Za-z]+)=([0-9]+)$/.exec(arg);
    if(!match||!allowed.has(match[1])||Object.hasOwn(args,match[1]))
      throw new Error('Unknown, duplicated or invalid qualification option: '+arg);
    args[match[1]]=match[2];
  }
  return Object.freeze({
    mode,
    iterations:integerOption(args.iterations??(mode==='benchmark'?120:50000),{name:'iterations',min:1,max:50000}),
    concurrency:integerOption(args.concurrency??4,{name:'concurrency',min:1,max:16}),
    durationMs:integerOption(args.durationMs??(mode==='benchmark'?8000:120000),{name:'durationMs',min:500,max:600000}),
    fetchSize:integerOption(args.fetchSize??32,{name:'fetchSize',min:1,max:256}),
    cursorRows:integerOption(args.cursorRows??1000,{name:'cursorRows',min:100,max:1000})
  });
}
export function safeError(error){
  // Deliberately never emit .message or stack: they may contain credentials/SQL.
  return error&&typeof error.code==='string'&&/^[A-Z_]{2,32}$/.test(error.code)
    ?error.code:'UNCLASSIFIED_ERROR';
}
