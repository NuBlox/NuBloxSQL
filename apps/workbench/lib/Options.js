'use strict';

// Workbench owns its local HTTP listener and connection argument policy.
// The driver owns database protocol validation; Shell is not a dependency.
const CONNECTION_FLAGS = Object.freeze({
  '--url':'url','--dialect':'dialect','--host':'host','--user':'user',
  '--database':'database','--filename':'filename'
});
const UNSUPPORTED_SHELL_FLAGS = new Set([
  '--execute','-e','--command','-c','--stdin','--doctor','--format'
]);

function valueAfter(args,index,flag) {
  if (index+1>=args.length || typeof args[index+1]!=='string' ||
      args[index+1].startsWith('--')) {
    throw new TypeError('NuBlox Workbench '+flag+' requires a value');
  }
  return args[index+1];
}
function port(value,flag,allowZero) {
  const parsed=Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) ||
      parsed<(allowZero?0:1) || parsed>65535) {
    throw new RangeError('NuBlox Workbench '+flag+' must be an integer '+
      (allowZero?'from 0':'from 1')+' to 65535');
  }
  return parsed;
}
function scalar(value) {
  if(value==='true')return true;
  if(value==='false')return false;
  if(value==='null')return null;
  if(/^-?\d+(?:\.\d+)?$/.test(value))return Number(value);
  return value;
}
function parseArgs(argv=[]) {
  if(!Array.isArray(argv))throw new TypeError('Workbench arguments must be an array');
  const options={listenPort:4277,extra:Object.create(null)};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(flag==='--help'||flag==='-h'){options.help=true;continue;}
    if(flag==='--version'||flag==='-v'){options.version=true;continue;}
    if(flag==='--demo'){options.demo=true;continue;}
    if(flag==='--pool'){options.pool=true;continue;}
    if(flag==='--no-pool'){options.pool=false;continue;}
    if(UNSUPPORTED_SHELL_FLAGS.has(flag)){
      throw new RangeError('NuBlox Workbench does not support Shell execution flag '+flag);
    }
    if(flag==='--port'||flag==='--listen-port'){
      options.listenPort=port(valueAfter(argv,i,flag),flag,true);i++;continue;
    }
    if(flag==='--db-port'){
      options.dbPort=port(valueAfter(argv,i,flag),flag,false);i++;continue;
    }
    if(Object.prototype.hasOwnProperty.call(CONNECTION_FLAGS,flag)){
      options[CONNECTION_FLAGS[flag]]=valueAfter(argv,i,flag);i++;continue;
    }
    if(flag==='--option'){
      const pair=valueAfter(argv,i,flag);
      const split=pair.indexOf('=');
      if(split<=0)throw new TypeError('NuBlox Workbench --option requires key=value');
      const key=pair.slice(0,split);
      if(['__proto__','prototype','constructor'].includes(key)){
        throw new TypeError('NuBlox Workbench --option contains a reserved key');
      }
      options.extra[key]=scalar(pair.slice(split+1));i++;continue;
    }
    throw new RangeError('Unknown NuBlox Workbench option "'+flag+'"');
  }
  return options;
}
function connectionFrom(options,env={}) {
  const url=options.url||env.NUBLOX_DATABASE_URL||env.DATABASE_URL;
  if(url)return url;
  const dialect=options.dialect||env.NUBLOX_DIALECT;
  if(!dialect)return null;
  const config=Object.assign({},options.extra,{dialect});
  for(const [key,variable] of [
    ['host','NUBLOX_HOST'],['user','NUBLOX_USER'],
    ['database','NUBLOX_DATABASE'],['filename','NUBLOX_FILENAME']
  ]){
    if(options[key]!==undefined)config[key]=options[key];
    else if(env[variable])config[key]=env[variable];
  }
  if(options.dbPort!==undefined)config.port=options.dbPort;
  else if(env.NUBLOX_PORT)config.port=Number(env.NUBLOX_PORT);
  if(env.NUBLOX_PASSWORD!==undefined)config.password=env.NUBLOX_PASSWORD;
  if(options.pool!==undefined)config.pool=options.pool;
  return config;
}
module.exports=Object.freeze({parseArgs,connectionFrom});
