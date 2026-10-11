'use strict';
(function(){
  const token=document.querySelector('meta[name="nublox-session"]').content;
  const $=function(id){return document.getElementById(id);};
  const editor=$('sql-editor');
  const resultContent=$('result-content');
  const tableList=$('table-list');
  const toast=$('toast');
  const completion=$('completion-panel');
  const editorTools=window.NuBloxEditorTools;
  const highlightLayer=$('sql-highlight');
  const lineGuide=document.querySelector('.line-guide');
  const columnCache=new Map();
  const columnRequests=new Set();
  let knownTables=[],knownColumns=[],editorDialect='sqlite';
  let completionItems=[],completionIndex=0;
  let lastRows=[];
  let lastColumns=[];
  let selectedName='';
  let activeTable=null;
  let browseOffset=0;
  let browseNonce=0;
  let selectNonce=0;
  let browseBusy=false;
  let canCancel=false;
  let queuedBrowse=null;
  let busy=false;
  let toastTimer;
  function node(tag,className,text){
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=String(text);
    return element;
  }
  function message(text,error){
    toast.textContent=String(text);
    toast.className='toast'+(error?' error':'');
    toast.hidden=false;
    window.clearTimeout(toastTimer);
    toastTimer=window.setTimeout(function(){toast.hidden=true;},4500);
  }
  async function api(route,body){
    const options={method:body?'POST':'GET',headers:{'x-nublox-session':token}};
    if(body){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
    const response=await fetch(route,options);
    let content;
    try{content=await response.json();}catch(_){throw new Error('Workbench returned an invalid response');}
    if(!response.ok)throw new Error(content.error||'Request failed');
    return content;
  }
  function displayStatus(text,isError){
    $('result-status').textContent=text;
    $('result-status').className='status-text'+(isError?' is-error':'');
  }
  function valueText(value){
    if(value===null)return 'NULL';
    if(value===undefined)return '';
    if(typeof value==='object')return JSON.stringify(value);
    return String(value);
  }
  function empty(text){
    const box=node('div','empty-state');
    box.append(node('div','empty-icon','▦'),node('h3','',text),node('p','','Run a query or select a table to explore your data.'));
    resultContent.replaceChildren(box);
  }
  function showResult(result){
    lastRows=result.rows||[];
    lastColumns=result.columns||[];
    $('export-csv').disabled=!lastRows.length;
    $('duration').textContent=result.elapsedMs+' ms';
    $('row-counter').textContent=result.shown+' row'+(result.shown===1?'':'s')+
      (result.truncated?' (display capped)':result.hasMore?' (more available)':'');
    $('result-caption').textContent=result.command||'Query complete';
    displayStatus('Executed');
    if(!lastRows.length){
      const box=node('div','empty-state');
      box.append(node('div','empty-icon','✓'),node('h3','','Statement executed'),node('p','', 'No result rows returned.'));
      resultContent.replaceChildren(box);
      return;
    }
    const wrapper=node('div','grid-scroll');
    const table=node('table','data-grid');
    const header=node('thead');
    const headRow=node('tr');
    headRow.append(node('th','row-index','#'));
    lastColumns.forEach(c=>headRow.append(node('th','',c)));
    header.append(headRow);
    const body=node('tbody');
    lastRows.forEach(function(item,index){
      const tr=node('tr');tr.append(node('td','row-index',(result.offset||0)+index+1));
      lastColumns.forEach(function(column){
        const value=item[column];
        const cell=node('td',value===null?'null-cell':'',valueText(value));
        cell.title=valueText(value).slice(0,300);
        tr.append(cell);
      });
      body.append(tr);
    });
    table.append(header,body);wrapper.append(table);
    resultContent.replaceChildren(wrapper);
  }
  function syncEditorScroll(){
    highlightLayer.style.transform='translate(' +(-editor.scrollLeft)+'px,'+(-editor.scrollTop)+'px)';
    const numbers=lineGuide.firstChild;
    if(numbers)numbers.style.transform='translateY('+(-editor.scrollTop)+'px)';
  }
  function renderHighlight(){
    if(!editorTools)return;
    const fragment=document.createDocumentFragment();
    for(const token of editorTools.highlight(editor.value,editorDialect)){
      const part=node('span','syntax-'+token.kind,token.text);
      fragment.append(part);
    }
    // No SQL or database value ever passes through innerHTML.
    highlightLayer.replaceChildren(fragment);
    const count=Math.min(2000,editor.value.split('\n').length);
    const gutter=node('div','line-number-list',Array.from({length:count},(_,i)=>String(i+1).padStart(2,'0')).join('\n'));
    lineGuide.replaceChildren(gutter);
    syncEditorScroll();
  }
  function hideCompletion(){
    completion.hidden=true;
    completion.replaceChildren();
    completionItems=[];
    completionIndex=0;
  }
  function applyCompletion(index){
    const item=completionItems[index];
    if(!item)return;
    editor.setRangeText(item.insert,item.from,item.to,'end');
    renderHighlight();
    hideCompletion();
    editor.focus();
  }
  function showCompletion(manual){
    if(!editorTools){hideCompletion();return;}
    const statement=editor.value;
    const cursor=editor.selectionStart;
    const aliasTable=editorTools.resolveColumnContext(statement,cursor,{
      dialect:editorDialect,tables:knownTables
    });
    let columns=knownColumns;
    if(aliasTable){
      const key=(aliasTable.schema||'')+'\u0000'+aliasTable.name;
      if(!columnCache.has(key)){
        hideCompletion();
        if(!columnRequests.has(key)){
          columnRequests.add(key);
          api('/api/columns',{name:aliasTable.name,schema:aliasTable.schema||undefined})
            .then(function(result){
              columnCache.set(key,result.columns||[]);
              if(editor.value===statement&&editor.selectionStart===cursor)showCompletion(manual);
            }).catch(function(e){message('Column completion: '+e.message,true);})
            .finally(function(){columnRequests.delete(key);});
        }
        return;
      }
      columns=columnCache.get(key);
    }
    const items=editorTools.suggestions(statement,cursor,{
      manual:manual===true,dialect:editorDialect,tables:knownTables,columns
    });
    if(!items.length){hideCompletion();return;}
    completionItems=items;
    completionIndex=0;
    completion.replaceChildren();
    items.forEach(function(item,i){
      const button=node('button','completion-item'+(i===0?' selected':''));
      button.type='button';
      button.setAttribute('role','option');
      button.setAttribute('aria-selected',i===0?'true':'false');
      button.append(node('span','completion-label',item.label),
        node('span','completion-kind',item.kind));
      button.addEventListener('mousedown',function(e){e.preventDefault();});
      button.addEventListener('click',function(){applyCompletion(i);});
      completion.append(button);
    });
    completion.hidden=false;
  }
  function moveCompletion(direction){
    if(!completionItems.length)return;
    completionIndex=(completionIndex+direction+completionItems.length)%completionItems.length;
    Array.from(completion.children).forEach(function(item,i){
      item.classList.toggle('selected',i===completionIndex);
      item.setAttribute('aria-selected',i===completionIndex?'true':'false');
    });
    completion.children[completionIndex].scrollIntoView({block:'nearest'});
  }
  async function explainSQL(){
    if(busy)return;
    const statement=editor.value.trim();
    if(!statement){message('Enter a SQL statement first',true);return;}
    hideCompletion();
    busy=true;
    $('explain-query').disabled=true;
    $('run-query').disabled=true;
    displayStatus('Planning…');
    try{
      const report=await api('/api/diagnose',{sql:statement});
      showResult({
        columns:['id','kind','table','index','detail'],
        rows:report.nodes,shown:report.nodes.length,
        rowCount:report.summary.nodeCount,
        truncated:report.truncated,command:'SQLite optimizer plan',elapsedMs:report.elapsedMs
      });
      displayStatus('Plan only');
      $('result-caption').textContent='Non-executing plan · SQL statement not run';
      const overview=node('div','plan-overview');
      overview.append(node('strong','',String(report.summary.nodeCount||0)+' optimizer nodes'));
      if(report.summary.hasFullScan)overview.append(node('span','plan-warning','Full table scan indicated'));
      if(report.summary.usesIndex)overview.append(node('span','plan-success','Index in use'));
      (report.warnings||[]).forEach(w=>overview.append(node('p','plan-warning',w.message)));
      if(report.truncated)overview.append(node('p','plan-warning','Only the first 100 plan nodes are displayed'));
      resultContent.prepend(overview);
    }catch(e){displayStatus('Plan failed',true);message(e.message,true);}
    finally{
      busy=false;
      $('explain-query').disabled=false;
      $('run-query').disabled=false;
    }
  }
  async function runSQL(){
    if(busy)return;
    ++browseNonce;
    $('browse-controls').hidden=true;
    const sql=editor.value.trim();
    if(!sql){message('Enter a SQL statement first',true);return;}
    hideCompletion();
    busy=true;$('run-query').disabled=true;
    $('explain-query').disabled=true;
    $('cancel-query').disabled=!canCancel;
    displayStatus('Running…');
    const start=performance.now();
    try {
      showResult(await api('/api/query',{sql:sql}));
    } catch(e) {
      displayStatus('Failed',true);message(e.message,true);
      $('result-caption').textContent='Database reported an error';
      $('duration').textContent=Math.round(performance.now()-start)+' ms';
    } finally {
      busy=false;$('run-query').disabled=false;
      $('explain-query').disabled=false;
      $('cancel-query').disabled=true;
    }
  }
  function setBrowseColumns(columns){
    knownColumns=Array.isArray(columns)?columns.slice():[];
    if(activeTable)columnCache.set((activeTable.schema||'')+'\u0000'+activeTable.name,knownColumns);
    const names=(columns||[]).map(c=>c.name);
    const primary=(columns||[]).find(c=>c.primaryKey===true);
    const sort=$('sort-column'), filter=$('filter-column');
    sort.replaceChildren();filter.replaceChildren();
    filter.append(node('option','', 'No filter'));
    filter.firstChild.value='';
    names.forEach(name=>{
      const sortOption=node('option','',name);sortOption.value=name;sort.append(sortOption);
      const filterOption=node('option','',name);filterOption.value=name;filter.append(filterOption);
    });
    sort.value=primary?primary.name:names[0]||'';
    sort.dataset.defaultSort=sort.value;
    $('sort-direction').value='asc';
    $('filter-value').value='';
  }
  async function browsePage(offset){
    if(!activeTable)return;
    if(browseBusy){queuedBrowse=offset;return;}
    const table=activeTable, nonce=++browseNonce;
    const column=$('filter-column').value, value=$('filter-value').value;
    const payload={name:table.name,schema:table.schema||undefined,
      offset,pageSize:50,sort:$('sort-column').value,
      direction:$('sort-direction').value};
    if(column)payload.filter={column,value};
    browseBusy=true;
    $('browse-prev').disabled=true;$('browse-next').disabled=true;
    displayStatus('Browsing…');
    try{
      const result=await api('/api/preview',payload);
      if(nonce!==browseNonce||activeTable!==table)return;
      browseOffset=result.offset;
      $('browse-page-label').textContent='Page '+(Math.floor(result.offset/result.pageSize)+1);
      $('browse-prev').disabled=result.offset===0;
      $('browse-next').disabled=!result.hasMore;
      showResult(result);
      $('browse-controls').hidden=false;
    }catch(e){
      if(nonce===browseNonce){displayStatus('Failed',true);message(e.message,true);}
    }finally{
      browseBusy=false;
      if(queuedBrowse!==null){
        const next=queuedBrowse;queuedBrowse=null;
        browsePage(next);
      }
    }
  }
  function choose(table,button){
    selectedName=(table.schema||'')+'.'+table.name;
    activeTable=table;const nonce=++selectNonce;
    ++browseNonce;browseOffset=0;
    tableList.querySelectorAll('button').forEach(b=>b.classList.remove('selected'));
    if(button)button.classList.add('selected');
    const parent=$('inspector-content');
    parent.replaceChildren(node('div','loading','Inspecting '+table.name+'…'));
    $('browse-controls').hidden=true;
    api('/api/columns',{name:table.name,schema:table.schema||undefined}).then(function(result){
      if(nonce!==selectNonce)return;
      const cols=result.columns||[];
      const title=node('div','inspect-identity');
      title.append(node('div','object-kind',table.type.toUpperCase()),node('h3','',table.name));
      const subtitle=node('p','inspect-schema',table.schema||'default schema');
      const heading=node('div','field-heading','COLUMNS · '+cols.length);
      const list=node('div','fields-list');
      cols.forEach(function(c){
        const item=node('div','field');
        const left=node('div','field-main');
        left.append(node('strong','',c.name),node('span','',c.dataType||'native'));
        item.append(left,node('div','field-flags',c.primaryKey?'KEY':c.nullable===false?'NOT NULL':''));
        list.append(item);
      });
      parent.replaceChildren(title,subtitle,heading,list);
      setBrowseColumns(cols);
      browsePage(0);
    }).catch(function(e){
      if(nonce===selectNonce){message(e.message,true);parent.replaceChildren(node('p','inspector-error',e.message));}
    });
  }
  async function refreshTables(){
    tableList.replaceChildren(node('div','loading','Refreshing catalogue…'));
    knownTables=[];
    columnCache.clear();
    try{
      const items=(await api('/api/tables')).tables||[];
      knownTables=items;
      $('table-count').textContent=items.length;
      tableList.replaceChildren();
      if(!items.length){tableList.append(node('p','loading','No tables in this schema'));return;}
      items.forEach(function(t){
        const button=node('button','object-item');
        button.type='button';
        button.append(node('span','table-symbol',t.type==='view'?'◇':'▤'),
          node('span','object-label',t.name),
          node('span','object-kind-small',t.type==='view'?'VIEW':''));
        button.addEventListener('click',function(){choose(t,button);});
        tableList.append(button);
      });
    }catch(e){tableList.replaceChildren(node('p','inspector-error',e.message));message(e.message,true);}
  }
  function csvCell(value){
    let text=value===null||value===undefined?'':valueText(value);
    // Prevent spreadsheet formula execution when CSV is opened in Excel/Sheets.
    if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
    return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
  }
  function exportCSV(){
    if(!lastRows.length)return;
    const lines=[lastColumns.map(csvCell).join(',')];
    lastRows.forEach(r=>lines.push(lastColumns.map(c=>csvCell(r[c])).join(',')));
    const url=URL.createObjectURL(new Blob([lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='nublox-query-results.csv';link.click();
    window.setTimeout(function(){URL.revokeObjectURL(url);},1000);
    message('CSV exported — '+lastRows.length+' displayed rows');
  }
  $('run-query').addEventListener('click',runSQL);
  $('explain-query').addEventListener('click',explainSQL);
  $('cancel-query').addEventListener('click',async function(){
    $('cancel-query').disabled=true;
    try{
      const status=await api('/api/cancel',{});
      if(status.status==='cancellation-requested')message('Cancellation requested; waiting for database confirmation');
    }catch(e){message(e.message,true);}
  });
  $('refresh-tables').addEventListener('click',refreshTables);
  $('export-csv').addEventListener('click',exportCSV);
  $('apply-browse').addEventListener('click',function(){browsePage(0);});
  $('clear-browse').addEventListener('click',function(){
    $('filter-column').value='';$('filter-value').value='';
    $('sort-direction').value='asc';
    $('sort-column').value=$('sort-column').dataset.defaultSort||'';
    browsePage(0);
  });
  $('browse-prev').addEventListener('click',function(){browsePage(Math.max(0,browseOffset-50));});
  $('browse-next').addEventListener('click',function(){browsePage(browseOffset+50);});
  $('filter-value').addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();browsePage(0);}
  });
  editor.addEventListener('keydown',function(e){
    if(e.code==='Space'&&e.ctrlKey){e.preventDefault();showCompletion(true);return;}
    if(!completion.hidden){
      if(e.key==='ArrowDown'){e.preventDefault();moveCompletion(1);return;}
      if(e.key==='ArrowUp'){e.preventDefault();moveCompletion(-1);return;}
      if(e.key==='Escape'){e.preventDefault();hideCompletion();return;}
      if(e.key==='Tab'||(e.key==='Enter'&&!e.ctrlKey&&!e.metaKey)){
        e.preventDefault();applyCompletion(completionIndex);return;
      }
    }
    if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();runSQL();return;}
    if(e.key==='Tab'){
      e.preventDefault();const start=editor.selectionStart;
      editor.setRangeText('  ',start,editor.selectionEnd,'end');
      renderHighlight();
    }
  });
  editor.addEventListener('input',function(){
    renderHighlight();
    if(editor.selectionStart===editor.selectionEnd)showCompletion(false);
    else hideCompletion();
  });
  editor.addEventListener('scroll',syncEditorScroll);
  editor.addEventListener('click',hideCompletion);
  editor.addEventListener('blur',function(){window.setTimeout(hideCompletion,125);});
  Promise.all([api('/api/status'),refreshTables()]).then(function(results){
    const status=results[0];
    $('connection-state').textContent=status.status;
    $('connection-dialect').textContent=status.dialect.toUpperCase();
    $('language-label').textContent=status.dialect.toUpperCase();
    editorDialect=status.dialect;
    renderHighlight();
    $('explain-query').hidden=!(status.editorFeatures&&status.editorFeatures.planSupported===true);
    $('connection-led').classList.add('live');
    canCancel=status.queryControl&&status.queryControl.cancelSupported===true;
    $('cancel-query').hidden=!canCancel;
    if(status.queryControl&&status.queryControl.nativeRowByteBudget){
      $('result-caption').textContent='Query budgets: '+status.maxRows+' rows · 1 MiB result data';
    }else{
      $('result-caption').textContent='Native SQL results may exceed the displayed-row cap';
    }
    if(status.demo)editor.value='SELECT id, name FROM nublox_demo ORDER BY id;';
    renderHighlight();
  }).catch(function(e){$('connection-state').textContent='Unavailable';message(e.message,true);});
})();
