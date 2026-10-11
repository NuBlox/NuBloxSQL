'use strict';

// Normalize the existing public NuBloxSQL diagnostic reports for the local
// Workbench. Never run EXPLAIN ANALYZE or return raw SQL/driver documents.
const SUPPORTED=new Set(['sqlite','postgresql','mysql']);
const NODE_CAP=100;
function safe(value){
  if(value===null||value===undefined)return null;
  return String(value).slice(0,256);
}
function normalizePlan(dialect,report,elapsedMs){
  if(!SUPPORTED.has(dialect))throw new RangeError('Dialect has no Workbench plan adapter');
  if(!report||report.statementExecuted!==false||report.analyzed===true){
    throw new Error('Workbench refuses diagnostic reports that executed a statement');
  }
  const nodes=[],warnings=[];
  let count=0;
  function add(parentId,kind,table,index,detail){
    count++;
    if(nodes.length>=NODE_CAP)return null;
    const id=nodes.length+1;
    nodes.push({id,parentId,kind:safe(kind)||'other',table:safe(table),index:safe(index),detail:safe(detail)||'Planner node'});
    return id;
  }
  function warn(code,message,nodeId){
    if(warnings.length<50)warnings.push({code,message,nodeId});
  }
  if(dialect==='sqlite'){
    const native=report.native&&report.native.plan;
    if(!native||!Array.isArray(native.nodes))throw new Error('SQLite did not return a native plan');
    count=native.nodes.length;
    const selected=native.nodes.slice(0,NODE_CAP);
    for(const node of selected){
      nodes.push({id:node.id,parentId:node.parentId,kind:safe(node.kind)||'other',
        table:safe(node.table),index:safe(node.index),detail:safe(node.detail)});
    }
    (native.warnings||[]).slice(0,50).forEach(w=>warn(safe(w.code),safe(w.message),w.nodeId));
  }else if(dialect==='postgresql'){
    const root=report.native&&report.native.root;
    if(!root||typeof root!=='object')throw new Error('PostgreSQL did not return a JSON plan');
    function visit(node,parentId,depth){
      if(!node||typeof node!=='object'||depth>40)return;
      const kind=safe(node['Node Type'])||'other';
      const id=add(parentId,kind,node['Relation Name'],node['Index Name'],
        kind+(node['Join Type']?' ('+safe(node['Join Type'])+')':''));
      if(kind==='Seq Scan')warn('sequential-scan','PostgreSQL plan includes a sequential scan; evaluate table size and indexes',id);
      if(Array.isArray(node.Plans)){
        for(const child of node.Plans.slice(0,100))visit(child,id,depth+1);
      }
    }
    visit(root,null,0);
  }else{
    const root=report.native&&report.native.root;
    if(!root||typeof root!=='object')throw new Error('MySQL did not return a JSON plan');
    function visit(value,parentId,depth){
      if(!value||typeof value!=='object'||depth>40)return;
      if(Array.isArray(value)){
        for(const item of value.slice(0,100))visit(item,parentId,depth+1);
        return;
      }
      const kind=safe(value.operation)||safe(value.access_type)||
        (value.table_name?'table access':null);
      const id=kind?add(parentId,kind,value.table_name,value.key||value.index_name,kind):parentId;
      const access=String(value.access_type||'').toUpperCase();
      if(access==='ALL')warn('full-scan','MySQL plan includes a full table scan',id);
      for(const key of Object.keys(value).slice(0,100)){
        if(value[key]&&typeof value[key]==='object')visit(value[key],id,depth+1);
      }
    }
    visit(root,null,0);
  }
  const summary={
    nodeCount:count,
    usesIndex:nodes.some(n=>n.index!==null||/INDEX/i.test(n.kind)),
    hasFullScan:warnings.some(w=>w.code==='full-scan'||w.code==='sequential-scan'||
      w.code==='full-table-scan'),
    estimatedRows:report.summary&&report.summary.estimatedRows||null,
    estimatedCost:report.summary&&report.summary.estimatedCost||null
  };
  return {
    mode:'plan',dialect,statementExecuted:false,summary,warnings,nodes,
    truncated:count>nodes.length,elapsedMs
  };
}
module.exports=Object.freeze({SUPPORTED,normalizePlan});
