'use strict';

var typedValues = require('../core/TypedValue');
var SCHEMA_VERSION = 1;
var DECISIONS = Object.freeze([
  'native-equivalent',
  'lossless-map',
  'lossy-map',
  'application-convention',
  'unsupported',
  'runtime-qualified'
]);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function intOrNull(value){
  return Number.isInteger(value) ? value : null;
}
function normalizeDialect(value){
  value=String(value||'').toLowerCase();
  if(value==='postgres'||value==='pg')return 'postgresql';
  if(value==='mssql'||value==='sql-server')return 'sqlserver';
  return value;
}
function canonical(family, options){
  options=options||{};
  return freeze({
    family:family,
    precision:intOrNull(options.precision),
    scale:intOrNull(options.scale),
    length:intOrNull(options.length),
    timezone:options.timezone===true,
    unsigned:options.unsigned===true,
    native:options.native||null
  });
}
function parseArgs(type){
  var m=String(type||'').match(/\((\d+)(?:\s*,\s*(\d+))?\)/);
  return m?{first:Number(m[1]),second:m[2]===undefined?null:Number(m[2])}:{first:null,second:null};
}
function base(type){
  return String(type||'').trim().toLowerCase().replace(/\s+/g,' ');
}
function infer(dialect, nativeType, metadata){
  dialect=normalizeDialect(dialect);
  var raw=base(nativeType || (metadata&&metadata.nativeType) || (metadata&&metadata.dataType));
  var args=parseArgs(raw);
  if(!raw)return null;

  if(dialect==='postgresql'){
    if(raw==='boolean'||raw==='bool')return canonical('boolean',{native:raw});
    if(raw==='smallint'||raw==='int2')return canonical('int16',{native:raw});
    if(raw==='integer'||raw==='int'||raw==='int4')return canonical('int32',{native:raw});
    if(raw==='bigint'||raw==='int8')return canonical('int64',{native:raw});
    if(raw.indexOf('numeric')===0||raw.indexOf('decimal')===0)return canonical('decimal',{precision:args.first,scale:args.second,native:raw});
    if(raw==='real'||raw==='float4')return canonical('float32',{native:raw});
    if(raw==='double precision'||raw==='float8')return canonical('float64',{native:raw});
    if(raw==='text'||raw.indexOf('character varying')===0||raw.indexOf('varchar')===0||raw.indexOf('character(')===0||raw.indexOf('char(')===0)return canonical('text',{length:args.first,native:raw});
    if(raw==='bytea')return canonical('binary',{native:raw});
    if(raw==='uuid')return canonical('uuid',{native:raw});
    if(raw==='json'||raw==='jsonb')return canonical('json',{native:raw});
    if(raw==='date')return canonical('date',{native:raw});
    if(/^time(?:\(\d+\))? with time zone$/.test(raw)||raw.indexOf('timetz')===0)return canonical('time',{scale:args.first,timezone:true,native:raw});
    if(raw.indexOf('time')===0)return canonical('time',{scale:args.first,native:raw});
    if(/^timestamp(?:\(\d+\))? with time zone$/.test(raw)||raw.indexOf('timestamptz')===0)return canonical('timestamp',{scale:args.first,timezone:true,native:raw});
    if(raw.indexOf('timestamp')===0)return canonical('timestamp',{scale:args.first,native:raw});
    if(/\[\]$/.test(raw))return canonical('array',{native:raw});
    return canonical('native',{native:raw});
  }

  if(dialect==='mysql'){
    if(raw==='boolean'||raw==='bool'||/^tinyint\(1\)/.test(raw))return canonical('boolean',{native:raw});
    if(raw.indexOf('smallint')===0)return canonical('int16',{unsigned:/unsigned/.test(raw),native:raw});
    if(raw.indexOf('mediumint')===0||raw.indexOf('int')===0||raw.indexOf('integer')===0)return canonical('int32',{unsigned:/unsigned/.test(raw),native:raw});
    if(raw.indexOf('bigint')===0)return canonical('int64',{unsigned:/unsigned/.test(raw),native:raw});
    if(raw.indexOf('decimal')===0||raw.indexOf('numeric')===0)return canonical('decimal',{precision:args.first,scale:args.second,unsigned:/unsigned/.test(raw),native:raw});
    if(raw.indexOf('float')===0)return canonical('float32',{native:raw});
    if(raw.indexOf('double')===0||raw.indexOf('real')===0)return canonical('float64',{native:raw});
    if(/char|text|enum|set/.test(raw))return canonical('text',{length:args.first,native:raw});
    if(/binary|blob/.test(raw))return canonical('binary',{length:args.first,native:raw});
    if(raw==='json')return canonical('json',{native:raw});
    if(raw==='date')return canonical('date',{native:raw});
    if(raw.indexOf('time')===0)return canonical('time',{scale:args.first,native:raw});
    if(raw.indexOf('datetime')===0)return canonical('timestamp',{scale:args.first,native:raw});
    if(raw.indexOf('timestamp')===0)return canonical('timestamp',{scale:args.first,timezone:true,native:raw});
    return canonical('native',{native:raw});
  }

  if(dialect==='sqlite'){
    if(raw.indexOf('int')!==-1)return canonical('int64',{native:raw});
    if(/real|floa|doub/.test(raw))return canonical('float64',{native:raw});
    if(/blob/.test(raw))return canonical('binary',{native:raw});
    if(/char|clob|text/.test(raw))return canonical('text',{native:raw});
    if(/numeric|decimal/.test(raw))return canonical('decimal',{precision:args.first,scale:args.second,native:raw});
    if(raw==='boolean'||raw==='bool')return canonical('boolean',{native:raw});
    if(raw==='date')return canonical('date',{native:raw});
    if(raw.indexOf('datetime')!==-1||raw.indexOf('timestamp')!==-1)return canonical('timestamp',{native:raw});
    if(raw.indexOf('time')!==-1)return canonical('time',{native:raw});
    if(raw.indexOf('json')!==-1)return canonical('json',{native:raw});
    if(raw.indexOf('uuid')!==-1)return canonical('uuid',{native:raw});
    return canonical('native',{native:raw});
  }

  if(dialect==='sqlserver'){
    if(raw==='bit')return canonical('boolean',{native:raw});
    if(raw==='smallint'||raw==='tinyint')return canonical('int16',{unsigned:raw==='tinyint',native:raw});
    if(raw==='int')return canonical('int32',{native:raw});
    if(raw==='bigint')return canonical('int64',{native:raw});
    if(raw.indexOf('decimal')===0||raw.indexOf('numeric')===0||raw==='money'||raw==='smallmoney')return canonical('decimal',{precision:args.first,scale:args.second,native:raw});
    if(raw==='real')return canonical('float32',{native:raw});
    if(raw.indexOf('float')===0)return canonical('float64',{native:raw});
    if(/char|text/.test(raw))return canonical('text',{length:args.first,native:raw});
    if(/binary|image/.test(raw))return canonical('binary',{length:args.first,native:raw});
    if(raw==='uniqueidentifier')return canonical('uuid',{native:raw});
    if(raw==='date')return canonical('date',{native:raw});
    if(raw.indexOf('time')===0)return canonical('time',{scale:args.first,native:raw});
    if(raw.indexOf('datetimeoffset')===0)return canonical('timestamp',{scale:args.first,timezone:true,native:raw});
    if(raw.indexOf('datetime2')===0||raw==='datetime'||raw==='smalldatetime')return canonical('timestamp',{scale:args.first,native:raw});
    if(raw==='json')return canonical('json',{native:raw});
    return canonical('native',{native:raw});
  }

  return canonical('native',{native:raw});
}

function decision(decision, nativeType, reason, lossy){
  return freeze({
    decision:decision,
    nativeType:nativeType||null,
    lossless:lossy===true?false:(decision==='unsupported'?null:true),
    reason:reason
  });
}
function decimalSql(name,spec,maxPrecision){
  var precision=spec.precision;
  var scale=spec.scale;
  if(precision===null)return name;
  if(maxPrecision&&precision>maxPrecision)return null;
  if(scale===null)scale=0;
  return name+'('+precision+','+scale+')';
}

function target(dialect,spec){
  dialect=normalizeDialect(dialect);
  if(!spec||typeof spec!=='object'||typeof spec.family!=='string')throw new TypeError('NuBloxSQL canonical type mapping requires a canonical type descriptor');
  var f=spec.family;

  if(dialect==='postgresql'){
    if(f==='boolean')return decision('native-equivalent','BOOLEAN','PostgreSQL has a native boolean type.');
    if(f==='int16')return decision('native-equivalent','SMALLINT','16-bit signed integer.');
    if(f==='int32')return decision('native-equivalent','INTEGER','32-bit signed integer.');
    if(f==='int64'&&!spec.unsigned)return decision('native-equivalent','BIGINT','64-bit signed integer.');
    if(f==='int64'&&spec.unsigned)return decision('lossless-map','NUMERIC(20,0)','PostgreSQL BIGINT is signed; NUMERIC(20,0) preserves the full unsigned 64-bit range.');
    if(f==='decimal'){var pgd=decimalSql('NUMERIC',spec,1000);return pgd?decision('native-equivalent',pgd,'Exact decimal mapping.'):decision('unsupported',null,'Requested decimal precision exceeds the supported NuBloxSQL PostgreSQL mapping envelope.');}
    if(f==='float32')return decision('native-equivalent','REAL','IEEE-style single precision.');
    if(f==='float64')return decision('native-equivalent','DOUBLE PRECISION','IEEE-style double precision.');
    if(f==='text')return decision('native-equivalent',spec.length?'VARCHAR('+spec.length+')':'TEXT','Native PostgreSQL character type.');
    if(f==='binary')return decision('native-equivalent','BYTEA','Native variable-length binary type.');
    if(f==='uuid')return decision('native-equivalent','UUID','Native UUID type.');
    if(f==='json')return decision('native-equivalent','JSONB','Native JSON representation; JSONB chosen for canonical storage semantics.');
    if(f==='date')return decision('native-equivalent','DATE','Native date type.');
    if(f==='time'){
      var pgtScale=spec.scale===null?null:Math.min(spec.scale,6);
      return decision(spec.scale!==null&&spec.scale>6?'lossy-map':'native-equivalent','TIME'+(pgtScale!==null?'('+pgtScale+')':'')+(spec.timezone?' WITH TIME ZONE':''),spec.scale!==null&&spec.scale>6?'PostgreSQL time precision is capped at 6 fractional digits.':'Native time type.',spec.scale!==null&&spec.scale>6);
    }
    if(f==='timestamp'){
      var pgtsScale=spec.scale===null?null:Math.min(spec.scale,6);
      return decision(spec.scale!==null&&spec.scale>6?'lossy-map':'native-equivalent','TIMESTAMP'+(pgtsScale!==null?'('+pgtsScale+')':'')+(spec.timezone?' WITH TIME ZONE':''),spec.scale!==null&&spec.scale>6?'PostgreSQL timestamp precision is capped at 6 fractional digits.':'Native timestamp type.',spec.scale!==null&&spec.scale>6);
    }
    if(f==='array')return decision('runtime-qualified',null,'Array element type is required before a PostgreSQL array mapping can be rendered.');
    return decision('unsupported',null,'No canonical mapping is defined for this type family.');
  }

  if(dialect==='mysql'){
    if(f==='boolean')return decision('application-convention','TINYINT(1)','MySQL BOOLEAN is a synonym for TINYINT(1).');
    if(f==='int16')return decision('native-equivalent',spec.unsigned?'SMALLINT UNSIGNED':'SMALLINT','Integer width mapping.');
    if(f==='int32')return decision('native-equivalent',spec.unsigned?'INT UNSIGNED':'INT','Integer width mapping.');
    if(f==='int64')return decision('native-equivalent',spec.unsigned?'BIGINT UNSIGNED':'BIGINT','Integer width mapping.');
    if(f==='decimal'){var myd=decimalSql('DECIMAL',spec,65);return myd?decision('native-equivalent',myd,'Exact decimal mapping within MySQL precision limits.'):decision('unsupported',null,'Requested decimal precision exceeds MySQL DECIMAL limits.');}
    if(f==='float32')return decision('native-equivalent','FLOAT','Single-precision floating point.');
    if(f==='float64')return decision('native-equivalent','DOUBLE','Double-precision floating point.');
    if(f==='text')return decision('lossless-map',spec.length&&spec.length<=65535?'VARCHAR('+spec.length+')':'LONGTEXT','Character data mapping.');
    if(f==='binary')return decision('lossless-map','LONGBLOB','Binary data mapping.');
    if(f==='uuid')return decision('application-convention','CHAR(36)','MySQL has no dedicated UUID storage type in the released NuBloxSQL model.');
    if(f==='json')return decision('native-equivalent','JSON','Native JSON type.');
    if(f==='date')return decision('native-equivalent','DATE','Native date type.');
    if(f==='time'){
      var myTimeScale=spec.scale===null?null:Math.min(spec.scale,6);
      return decision(spec.scale!==null&&spec.scale>6?'lossy-map':'native-equivalent','TIME'+(myTimeScale!==null?'('+myTimeScale+')':''),spec.scale!==null&&spec.scale>6?'MySQL fractional-seconds precision is capped at 6 digits.':'Native time type.',spec.scale!==null&&spec.scale>6);
    }
    if(f==='timestamp'&&!spec.timezone){
      var myDateScale=spec.scale===null?null:Math.min(spec.scale,6);
      return decision(spec.scale!==null&&spec.scale>6?'lossy-map':'lossless-map','DATETIME'+(myDateScale!==null?'('+myDateScale+')':''),spec.scale!==null&&spec.scale>6?'MySQL fractional-seconds precision is capped at 6 digits.':'Timezone-free canonical timestamp maps to DATETIME.',spec.scale!==null&&spec.scale>6);
    }
    if(f==='timestamp'&&spec.timezone)return decision('lossy-map','TIMESTAMP'+(spec.scale!==null?'('+Math.min(spec.scale,6)+')':''),'MySQL TIMESTAMP normalizes through session time zone and does not preserve an arbitrary source offset.',true);
    if(f==='array')return decision('unsupported',null,'MySQL has no native SQL array type for this canonical mapping.');
    return decision('unsupported',null,'No canonical mapping is defined for this type family.');
  }

  if(dialect==='sqlite'){
    if(f==='boolean')return decision('application-convention','INTEGER','Boolean uses integer 0/1 convention.');
    if(f==='int16'||f==='int32')return decision('lossless-map','INTEGER','SQLite signed 64-bit INTEGER preserves signed and unsigned 16/32-bit values.');
    if(f==='int64')return decision(spec.unsigned?'lossy-map':'lossless-map','INTEGER',spec.unsigned?'SQLite INTEGER cannot represent the upper half of the unsigned 64-bit range.':'SQLite INTEGER preserves signed 64-bit values.',spec.unsigned===true);
    if(f==='decimal')return decision('application-convention','TEXT','TEXT is required by the canonical mapping to preserve exact decimal text.');
    if(f==='float32'||f==='float64')return decision('lossless-map','REAL','SQLite REAL uses floating-point storage.');
    if(f==='text')return decision('native-equivalent','TEXT','SQLite TEXT storage class.');
    if(f==='binary')return decision('native-equivalent','BLOB','SQLite BLOB storage class.');
    if(f==='uuid')return decision('application-convention','TEXT','UUID stored as canonical text.');
    if(f==='json')return decision('application-convention','TEXT','JSON stored as text; JSON function availability is runtime-dependent.');
    if(f==='date'||f==='time'||f==='timestamp')return decision('application-convention','TEXT','Temporal values use an ISO-8601 text convention.');
    if(f==='array')return decision('unsupported',null,'SQLite has no native SQL array type.');
    return decision('application-convention',spec.native||'BLOB','SQLite type affinity cannot guarantee native semantic equivalence.');
  }

  if(dialect==='sqlserver'){
    if(f==='boolean')return decision('native-equivalent','BIT','Native bit/boolean storage.');
    if(f==='int16')return decision(spec.unsigned?'lossless-map':'native-equivalent',spec.unsigned?'INT':'SMALLINT','SQL Server TINYINT is unsigned 8-bit; INT safely carries unsigned 16-bit values.');
    if(f==='int32')return decision(spec.unsigned?'lossless-map':'native-equivalent',spec.unsigned?'BIGINT':'INT','BIGINT safely carries unsigned 32-bit values.');
    if(f==='int64'&&!spec.unsigned)return decision('native-equivalent','BIGINT','64-bit signed integer.');
    if(f==='int64'&&spec.unsigned)return decision('lossless-map','DECIMAL(20,0)','DECIMAL(20,0) preserves the unsigned 64-bit range.');
    if(f==='decimal'){var ssd=decimalSql('DECIMAL',spec,38);return ssd?decision('native-equivalent',ssd,'Exact decimal mapping within SQL Server precision limits.'):decision('unsupported',null,'Requested decimal precision exceeds SQL Server DECIMAL limits.');}
    if(f==='float32')return decision('native-equivalent','REAL','Single-precision floating point.');
    if(f==='float64')return decision('native-equivalent','FLOAT(53)','Double-precision floating point.');
    if(f==='text')return decision('lossless-map',spec.length&&spec.length<=4000?'NVARCHAR('+spec.length+')':'NVARCHAR(MAX)','Unicode text mapping.');
    if(f==='binary')return decision('lossless-map',spec.length&&spec.length<=8000?'VARBINARY('+spec.length+')':'VARBINARY(MAX)','Binary data mapping.');
    if(f==='uuid')return decision('native-equivalent','UNIQUEIDENTIFIER','Native GUID/UUID type.');
    if(f==='json')return decision('application-convention','NVARCHAR(MAX)','JSON is stored in Unicode text in the released cross-version mapping.');
    if(f==='date')return decision('native-equivalent','DATE','Native date type.');
    if(f==='time'){
      var ssTimeScale=spec.scale===null?null:Math.min(spec.scale,7);
      return decision(spec.scale!==null&&spec.scale>7?'lossy-map':'native-equivalent','TIME'+(ssTimeScale!==null?'('+ssTimeScale+')':''),spec.scale!==null&&spec.scale>7?'SQL Server time precision is capped at 7 fractional digits.':'Native time type.',spec.scale!==null&&spec.scale>7);
    }
    if(f==='timestamp'&&!spec.timezone){
      var ssDateScale=spec.scale===null?null:Math.min(spec.scale,7);
      return decision(spec.scale!==null&&spec.scale>7?'lossy-map':'native-equivalent','DATETIME2'+(ssDateScale!==null?'('+ssDateScale+')':''),spec.scale!==null&&spec.scale>7?'SQL Server datetime2 precision is capped at 7 fractional digits.':'Native timezone-free timestamp.',spec.scale!==null&&spec.scale>7);
    }
    if(f==='timestamp'&&spec.timezone){
      var ssOffsetScale=spec.scale===null?null:Math.min(spec.scale,7);
      return decision(spec.scale!==null&&spec.scale>7?'lossy-map':'native-equivalent','DATETIMEOFFSET'+(ssOffsetScale!==null?'('+ssOffsetScale+')':''),spec.scale!==null&&spec.scale>7?'SQL Server datetimeoffset precision is capped at 7 fractional digits.':'Native timestamp with offset.',spec.scale!==null&&spec.scale>7);
    }
    if(f==='array')return decision('unsupported',null,'SQL Server has no native SQL array type in this mapping.');
    return decision('unsupported',null,'No canonical mapping is defined for this type family.');
  }

  return decision('unsupported',null,'Unsupported dialect for canonical type mapping.');
}

function fromPortableSpec(spec){
  var normalized=typedValues.normalizeTypeSpec(spec);
  if(normalized.type==='decimal')return canonical('decimal',{precision:normalized.precision,scale:normalized.scale,native:'portable:decimal'});
  if(normalized.type==='uuid')return canonical('uuid',{native:'portable:uuid'});
  if(normalized.type==='date')return canonical('date',{native:'portable:date'});
  if(normalized.type==='time')return canonical('time',{scale:normalized.scale,native:'portable:time'});
  if(normalized.type==='timestamp')return canonical('timestamp',{scale:normalized.scale,native:'portable:timestamp'});
  return canonical('native',{native:'portable:'+normalized.type});
}

function compatibility(fromDialect,toDialect,nativeType,metadata){
  var spec=infer(fromDialect,nativeType,metadata);
  if(!spec)return freeze({canonical:null,target:decision('unsupported',null,'Source type could not be classified.')});
  return freeze({canonical:spec,target:target(toDialect,spec)});
}

function annotate(snapshot){
  var portable=snapshot&&snapshot.portable?snapshot.portable:snapshot;
  if(!portable||!Array.isArray(portable.tables))throw new TypeError('NuBloxSQL type annotation requires portable metadata with tables');
  var dialect=portable.dialect||snapshot.dialect;
  return freeze({
    dialect:dialect,
    tables:portable.tables.map(function(table){
      return freeze({
        database:table.database,
        schema:table.schema,
        name:table.name,
        columns:(table.columns||[]).map(function(column){
          return freeze({
            name:column.name,
            nativeType:column.nativeType,
            canonical:infer(dialect,column.nativeType||column.dataType,column)
          });
        })
      });
    })
  });
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.DECISIONS=DECISIONS;
exports.canonical=canonical;
exports.infer=infer;
exports.target=target;
exports.compatibility=compatibility;
exports.fromPortableSpec=fromPortableSpec;
exports.annotate=annotate;
