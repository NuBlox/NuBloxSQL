'use strict';

var schemaDiff = require('./SchemaDiff');
var typeSemantics = require('./TypeSemantics');

var SCHEMA_VERSION = 1;
var EXECUTION = Object.freeze(['automatic','manual']);
var TRANSACTION = Object.freeze(['transactional-preferred','autocommit-boundary','manual']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}

function normalizeDialect(value){
  value=String(value||'').toLowerCase();
  if(value==='postgres'||value==='pg')return 'postgresql';
  if(value==='mssql'||value==='sql-server')return 'sqlserver';
  return value;
}

function quote(dialect,name){
  if(name===null||name===undefined||name==='')throw new TypeError('NuBloxSQL migration SQL requires an identifier');
  dialect=normalizeDialect(dialect);
  name=String(name);
  if(dialect==='mysql')return '`'+name.replace(/`/g,'``')+'`';
  if(dialect==='sqlserver')return '['+name.replace(/\]/g,']]')+']';
  return '"'+name.replace(/"/g,'""')+'"';
}

function qualified(dialect,value){
  var parts=[];
  if(value.schema)parts.push(quote(dialect,value.schema));
  if(value.table)parts.push(quote(dialect,value.table));
  else if(value.name)parts.push(quote(dialect,value.name));
  return parts.join('.');
}

function tableName(dialect,value){
  return qualified(dialect,{
    schema:value.schema,
    table:value.table||value.name
  });
}

function renderDefault(value){
  if(value===null||value===undefined)return null;
  if(typeof value==='number')return String(value);
  if(typeof value==='boolean')return value?'TRUE':'FALSE';
  var text=String(value);
  if(/^'.*'$/.test(text)||/^[A-Z_][A-Z0-9_]*(?:\([^)]*\))?$/i.test(text))return text;
  return "'"+text.replace(/'/g,"''")+"'";
}

function nativeType(dialect,column){
  var mapping=typeSemantics.target(dialect,column.canonicalType);
  if(!mapping.nativeType||mapping.decision==='unsupported'||mapping.decision==='runtime-qualified'){
    return {sql:null,mapping:mapping};
  }
  return {sql:mapping.nativeType,mapping:mapping};
}

function columnDefinition(dialect,column){
  var mapped=nativeType(dialect,column);
  if(!mapped.sql)return {sql:null,mapping:mapped.mapping};
  var sql=quote(dialect,column.name)+' '+mapped.sql;
  if(column.nullability==='not-null')sql+=' NOT NULL';
  var def=renderDefault(column.default);
  if(def!==null)sql+=' DEFAULT '+def;
  return {sql:sql,mapping:mapped.mapping};
}

function transactionStrategy(dialect){
  dialect=normalizeDialect(dialect);
  if(dialect==='mysql')return 'autocommit-boundary';
  if(dialect==='postgresql'||dialect==='sqlite'||dialect==='sqlserver')return 'transactional-preferred';
  return 'manual';
}

function stepId(index){return 'migration-step-'+String(index+1).padStart(4,'0');}

function phase(change){
  if(change.status==='removed'){
    if(change.kind==='foreign-key'||change.kind==='constraint'||change.kind==='index')return 10;
    if(change.kind==='column')return 20;
    if(change.kind==='table'||change.kind==='view'||change.kind==='foreign-table')return 30;
    return 40;
  }
  if(change.status==='modified')return 50;
  if(change.status==='added'){
    if(change.kind==='table'||change.kind==='view'||change.kind==='foreign-table')return 60;
    if(change.kind==='column')return 70;
    if(change.kind==='index'||change.kind==='constraint'||change.kind==='foreign-key')return 80;
    return 90;
  }
  return 100;
}

function automatic(sql,rollbackSql,notes){
  return {execution:'automatic',sql:sql,rollback:rollbackSql?freeze({mode:'compensating',sql:rollbackSql}):null,notes:notes||null};
}
function manual(reason){
  return {execution:'manual',sql:null,rollback:null,notes:reason};
}

function renderAdded(change,dialect){
  var value=change.after;
  if(value.kind==='column'){
    var def=columnDefinition(dialect,value);
    if(!def.sql)return manual('Target type cannot be rendered safely: '+def.mapping.reason);
    return automatic(
      'ALTER TABLE '+tableName(dialect,value)+' ADD COLUMN '+def.sql,
      'ALTER TABLE '+tableName(dialect,value)+' DROP COLUMN '+quote(dialect,value.name),
      def.mapping.decision==='lossy-map'||def.mapping.decision==='application-convention'?'Type mapping requires review: '+def.mapping.reason:null
    );
  }
  if(value.kind==='index'){
    if(!value.name||!value.keyParts||!value.keyParts.length)return manual('Index definition is incomplete for automatic rendering.');
    if(value.keyParts.some(function(part){return !part.column||part.expression||part.included||part.collation;}))return manual('Advanced index key parts require dialect-specific rendering.');
    var unique=value.unique?'UNIQUE ':'';
    var columns=value.keyParts.map(function(part){return quote(dialect,part.column)+(part.descending?' DESC':'');}).join(', ');
    return automatic(
      'CREATE '+unique+'INDEX '+quote(dialect,value.name)+' ON '+tableName(dialect,value)+' ('+columns+')',
      'DROP INDEX '+quote(dialect,value.name),
      null
    );
  }
  if(value.kind==='foreign-key'){
    if(dialect==='sqlite')return manual('SQLite foreign-key addition requires table rebuild planning.');
    if(!value.name)return manual('Unnamed foreign key cannot be rendered safely for later rollback.');
    var local=value.columns.map(function(name){return quote(dialect,name);}).join(', ');
    var remote=value.referencedColumns.map(function(name){return quote(dialect,name);}).join(', ');
    var target=qualified(dialect,{schema:value.referencedSchema,table:value.referencedTable});
    var sql='ALTER TABLE '+tableName(dialect,value)+' ADD CONSTRAINT '+quote(dialect,value.name)+' FOREIGN KEY ('+local+') REFERENCES '+target+' ('+remote+')';
    if(value.onDelete)sql+=' ON DELETE '+value.onDelete;
    if(value.onUpdate)sql+=' ON UPDATE '+value.onUpdate;
    return automatic(sql,'ALTER TABLE '+tableName(dialect,value)+' DROP CONSTRAINT '+quote(dialect,value.name),null);
  }
  return manual('Automatic '+value.kind+' creation is not yet in migration planner v1.');
}

function renderRemoved(change,dialect){
  var value=change.before;
  if(value.kind==='column'){
    if(dialect==='sqlite')return manual('SQLite DROP COLUMN requires runtime/version qualification before automatic planning.');
    return automatic('ALTER TABLE '+tableName(dialect,value)+' DROP COLUMN '+quote(dialect,value.name),null,'Destructive removal has no automatic data-preserving rollback.');
  }
  if(value.kind==='index'){
    if(dialect==='mysql')return automatic('DROP INDEX '+quote(dialect,value.name)+' ON '+tableName(dialect,value),null,'Index recreation is not emitted automatically.');
    return automatic('DROP INDEX '+quote(dialect,value.name),null,'Index recreation is not emitted automatically.');
  }
  if(value.kind==='foreign-key'||value.kind==='constraint'){
    if(dialect==='sqlite')return manual('SQLite constraint removal requires table rebuild planning.');
    if(!value.name)return manual('Unnamed constraint cannot be targeted safely.');
    return automatic('ALTER TABLE '+tableName(dialect,value)+' DROP CONSTRAINT '+quote(dialect,value.name),null,'Constraint recreation is not emitted automatically.');
  }
  if(value.kind==='table'){
    return automatic('DROP TABLE '+tableName(dialect,value),null,'Destructive table removal has no automatic data-preserving rollback.');
  }
  return manual('Automatic '+value.kind+' removal is not yet in migration planner v1.');
}

function renderModified(change,dialect){
  var before=change.before,after=change.after;
  if(before.kind!=='column')return manual('Automatic modification is currently limited to simple column changes.');

  var properties=change.deltas.map(function(delta){return delta.property;});
  if(properties.length===1&&properties[0]==='canonicalType'){
    var mapped=nativeType(dialect,after);
    if(!mapped.sql)return manual('Target type cannot be rendered safely: '+mapped.mapping.reason);
    if(dialect==='postgresql'){
      return automatic(
        'ALTER TABLE '+tableName(dialect,after)+' ALTER COLUMN '+quote(dialect,after.name)+' TYPE '+mapped.sql,
        null,
        mapped.mapping.decision==='lossy-map'?'Potentially lossy type conversion.':null
      );
    }
    if(dialect==='sqlserver'){
      var nullable=after.nullability==='not-null'?' NOT NULL':' NULL';
      return automatic('ALTER TABLE '+tableName(dialect,after)+' ALTER COLUMN '+quote(dialect,after.name)+' '+mapped.sql+nullable,null,null);
    }
    return manual('Target dialect requires full column-definition or rebuild semantics for automatic type modification.');
  }

  if(properties.length===1&&properties[0]==='nullability'&&dialect==='postgresql'){
    return automatic(
      'ALTER TABLE '+tableName(dialect,after)+' ALTER COLUMN '+quote(dialect,after.name)+(after.nullability==='not-null'?' SET NOT NULL':' DROP NOT NULL'),
      'ALTER TABLE '+tableName(dialect,after)+' ALTER COLUMN '+quote(dialect,after.name)+(before.nullability==='not-null'?' SET NOT NULL':' DROP NOT NULL'),
      after.nullability==='not-null'?'Precondition must prove no NULL values exist.':null
    );
  }

  if(properties.length===1&&properties[0]==='default'&&dialect==='postgresql'){
    var def=renderDefault(after.default);
    var beforeDef=renderDefault(before.default);
    return automatic(
      'ALTER TABLE '+tableName(dialect,after)+' ALTER COLUMN '+quote(dialect,after.name)+(def===null?' DROP DEFAULT':' SET DEFAULT '+def),
      'ALTER TABLE '+tableName(dialect,after)+' ALTER COLUMN '+quote(dialect,after.name)+(beforeDef===null?' DROP DEFAULT':' SET DEFAULT '+beforeDef),
      null
    );
  }

  return manual('Column modification requires dialect-specific compound ALTER semantics.');
}

function preconditions(change){
  var checks=[];
  if(change.status==='removed')checks.push('Confirm dependent application/database objects are handled before removal.');
  if(change.status==='added'&&change.kind==='column'&&change.after.nullability==='not-null'&&change.after.default===null&&!change.after.identity&&!(change.after.generated&&change.after.generated.enabled)){
    checks.push('Provide a backfill/default strategy for existing rows before enforcing NOT NULL.');
  }
  if(change.status==='modified'&&change.kind==='column'){
    change.deltas.forEach(function(delta){
      if(delta.property==='nullability'&&delta.before==='nullable'&&delta.after==='not-null')checks.push('Verify the column contains no NULL values.');
      if(delta.property==='canonicalType'&&change.safety==='potentially-lossy')checks.push('Validate every existing value fits the target canonical type before conversion.');
    });
  }
  if(change.dependencies&&change.dependencies.some(function(edge){return edge.relation!=='contained-by'&&edge.relation!=='defined-on';})){
    checks.push('Review dependency edges attached to this object before execution.');
  }
  return checks;
}

function render(change,dialect){
  if(change.status==='added')return renderAdded(change,dialect);
  if(change.status==='removed')return renderRemoved(change,dialect);
  return renderModified(change,dialect);
}

function plan(diffInput,options){
  options=options||{};
  var diff=diffInput&&diffInput.schemaVersion===schemaDiff.SCHEMA_VERSION&&diffInput.changes?diffInput:null;
  if(!diff)throw new TypeError('NuBloxSQL migration planner requires a schema diff v'+schemaDiff.SCHEMA_VERSION);

  var dialect=normalizeDialect(options.targetDialect||diff.right.dialect);
  if(!dialect)throw new TypeError('NuBloxSQL migration planner requires a target dialect');

  var ordered=diff.changes.slice().sort(function(a,b){
    return phase(a)-phase(b)||a.logicalKey.localeCompare(b.logicalKey);
  });

  var steps=ordered.map(function(change,index){
    var rendered=render(change,dialect);
    return freeze({
      id:stepId(index),
      phase:phase(change),
      status:change.status,
      safety:change.safety,
      execution:rendered.execution,
      targetDialect:dialect,
      logicalKey:change.logicalKey,
      kind:change.kind,
      sql:rendered.sql,
      preconditions:freeze(preconditions(change)),
      rollback:rendered.rollback,
      notes:rendered.notes
    });
  });

  var automaticCount=steps.filter(function(step){return step.execution==='automatic';}).length;
  var manualCount=steps.length-automaticCount;
  var highest=schemaDiff.highestSafety(diff);

  return freeze({
    schemaVersion:SCHEMA_VERSION,
    diffSchemaVersion:schemaDiff.SCHEMA_VERSION,
    targetDialect:dialect,
    transactionStrategy:transactionStrategy(dialect),
    source:diff.left,
    target:diff.right,
    highestSafety:highest,
    executable:manualCount===0,
    summary:freeze({
      steps:steps.length,
      automatic:automaticCount,
      manual:manualCount,
      safe:diff.summary.safe,
      dependencySensitive:diff.summary['dependency-sensitive'],
      manualReview:diff.summary['manual-review'],
      potentiallyLossy:diff.summary['potentially-lossy'],
      destructive:diff.summary.destructive
    }),
    steps:freeze(steps)
  });
}

function automaticSteps(planValue){
  if(!planValue||planValue.schemaVersion!==SCHEMA_VERSION)throw new TypeError('NuBloxSQL migration plan v'+SCHEMA_VERSION+' required');
  return freeze(planValue.steps.filter(function(step){return step.execution==='automatic';}));
}

function manualSteps(planValue){
  if(!planValue||planValue.schemaVersion!==SCHEMA_VERSION)throw new TypeError('NuBloxSQL migration plan v'+SCHEMA_VERSION+' required');
  return freeze(planValue.steps.filter(function(step){return step.execution==='manual';}));
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.EXECUTION=EXECUTION;
exports.TRANSACTION=TRANSACTION;
exports.plan=plan;
exports.automaticSteps=automaticSteps;
exports.manualSteps=manualSteps;
