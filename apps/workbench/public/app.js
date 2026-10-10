'use strict';
(function(){
  const token=document.querySelector('meta[name="nublox-session"]').content;
  const $=function(id){return document.getElementById(id);};
  const editor=$('sql-editor');
  const resultContent=$('result-content');
  const tableList=$('table-list');
  const toast=$('toast');
  let lastRows=[];
  let lastColumns=[];
  let selectedName='';
  let activeTable=null;
  let browseOffset=0;
  let browseNonce=0;
  let selectNonce=0;
  let browseBusy=false;
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
  async function runSQL(){
    if(busy)return;
    ++browseNonce;
    $('browse-controls').hidden=true;
    const sql=editor.value.trim();
    if(!sql){message('Enter a SQL statement first',true);return;}
    busy=true;$('run-query').disabled=true;displayStatus('Running…');
    const start=performance.now();
    try {
      showResult(await api('/api/query',{sql:sql}));
    } catch(e) {
      displayStatus('Failed',true);message(e.message,true);
      $('result-caption').textContent='Database reported an error';
      $('duration').textContent=Math.round(performance.now()-start)+' ms';
    } finally {busy=false;$('run-query').disabled=false;}
  }
  function setBrowseColumns(columns){
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
    try{
      const items=(await api('/api/tables')).tables||[];
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
    if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();runSQL();}
    if(e.key==='Tab'){e.preventDefault();const start=editor.selectionStart;editor.setRangeText('  ',start,editor.selectionEnd,'end');}
  });
  Promise.all([api('/api/status'),refreshTables()]).then(function(results){
    const status=results[0];
    $('connection-state').textContent=status.status;
    $('connection-dialect').textContent=status.dialect.toUpperCase();
    $('language-label').textContent=status.dialect.toUpperCase();
    $('connection-led').classList.add('live');
    if(status.demo)editor.value='SELECT id, name FROM nublox_demo ORDER BY id;';
  }).catch(function(e){$('connection-state').textContent='Unavailable';message(e.message,true);});
})();
