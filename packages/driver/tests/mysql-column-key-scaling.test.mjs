import test from 'node:test';
import assert from 'node:assert/strict';
import {columnKeys,objectRow} from '../dist/vendors/mysql/types.js';

const keys=names=>columnKeys(names.map(name=>({name})));
function reference(names){
  const originals=new Set(names),used=new Set();
  return names.map(name=>{
    let key=name,suffix=2;
    while(used.has(key)||(key!==name&&originals.has(key)))
      key=name+'#'+suffix++;
    used.add(key);
    return key;
  });
}

test('column alias suffix tracking preserves reserved and nested aliases',()=>{
  const names=['a','a','a#2','a#2','a','a#4','a#2#2','a#2','',
    '','#2','__proto__','__proto__','constructor','constructor','雪','雪'];
  const expected=['a','a#3','a#2','a#2#3','a#5','a#4','a#2#2','a#2#4','',
    '#3','#2','__proto__','__proto__#2','constructor','constructor#2','雪','雪#2'];
  assert.deepEqual(keys(names),expected);
  const values=names.map((_,i)=>i);
  const row=objectRow(values,expected);
  assert.equal(Object.getPrototypeOf(row),null);
  for(let i=0;i<expected.length;i++)assert.equal(row[expected[i]],i);
  assert.deepEqual(keys([]),[]);
  assert.deepEqual(keys(['a','b','c']),['a','b','c']);
});

test('wide duplicate projections skip reserved suffixes without losing ordinals',()=>{
  const reserved=Array.from({length:1024},(_,i)=>'id#'+(i+2));
  const names=[...Array(3072).fill('id'),...reserved];
  const actual=keys(names);
  assert.equal(actual.length,names.length);
  assert.equal(new Set(actual).size,names.length);
  assert.equal(actual[0],'id');
  for(let i=1;i<3072;i++)assert.equal(actual[i],'id#'+(1025+i));
  assert.deepEqual(actual.slice(3072),reserved);
});

test('column keys match the restart-at-two reference over mixed projections',()=>{
  const aliases=['a','a#2','a#3','a#02','a#2#2','a#2#3','','#2',
    '__proto__','constructor','toString','雪','雪#2'];
  let state=0x62e1a9;
  for(let i=0;i<300;i++){
    const names=Array.from({length:i%97},()=>{
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      return aliases[state%aliases.length];
    });
    assert.deepEqual(keys(names),reference(names));
  }
});
