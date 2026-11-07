/**
 * Strict decoding of MySQL Classic ColumnDefinition41 collation IDs.
 *
 * Only explicitly mapped IDs are accepted. Never guess an encoding based on
 * a nearby numeric ID, server language, connection address, or replacement
 * characters: a wrong guess changes SQL data silently.
 *
 * ID -> character-set mappings are exercised against the real server's
 * INFORMATION_SCHEMA.COLLATIONS in mysql-collations-live.test.mjs.
 */
const utf8=new TextDecoder('utf-8',{fatal:true});
const western=new TextDecoder('windows-1252',{fatal:true});

type CharsetName=
  'big5'|'sjis'|'cp932'|'euckr'|'gb2312'|'gbk'|'gb18030'|
  'latin2'|'cp1250'|'cp1251'|'greek'|'latin5'|'hebrew'|'cp1256'|
  'ucs2'|'utf16'|'utf16le'|'utf32';

/** Selected MySQL 8.4/9.x collation identifiers, not ordinal ranges. */
export const ADDITIONAL_MYSQL_COLLATIONS:readonly (readonly [number,CharsetName])[]=
  Object.freeze([
    [1,'big5'],[84,'big5'],
    [13,'sjis'],[88,'sjis'],
    [95,'cp932'],[96,'cp932'],
    [19,'euckr'],[85,'euckr'],
    [24,'gb2312'],[86,'gb2312'],
    [28,'gbk'],[87,'gbk'],
    [248,'gb18030'],[249,'gb18030'],[250,'gb18030'],
    [2,'latin2'],[9,'latin2'],[21,'latin2'],[27,'latin2'],[77,'latin2'],
    [26,'cp1250'],[34,'cp1250'],[66,'cp1250'],
    [14,'cp1251'],[23,'cp1251'],[50,'cp1251'],[51,'cp1251'],[52,'cp1251'],
    [25,'greek'],[70,'greek'],
    [30,'latin5'],[78,'latin5'],
    [16,'hebrew'],[71,'hebrew'],
    [57,'cp1256'],[67,'cp1256'],
    [35,'ucs2'],[90,'ucs2'],
    [54,'utf16'],[55,'utf16'],
    [56,'utf16le'],[62,'utf16le'],
    [60,'utf32'],[61,'utf32']
  ].map(pair=>Object.freeze(pair))) as readonly (readonly [number,CharsetName])[];

const additional=new Map<number,CharsetName>(ADDITIONAL_MYSQL_COLLATIONS);
const legacyDecoders:Readonly<Record<string,TextDecoder>>={
  big5:new TextDecoder('big5',{fatal:true}),
  sjis:new TextDecoder('shift_jis',{fatal:true}),
  cp932:new TextDecoder('shift_jis',{fatal:true}),
  euckr:new TextDecoder('euc-kr',{fatal:true}),
  gb2312:new TextDecoder('gbk',{fatal:true}),
  gbk:new TextDecoder('gbk',{fatal:true}),
  gb18030:new TextDecoder('gb18030',{fatal:true}),
  latin2:new TextDecoder('iso-8859-2',{fatal:true}),
  cp1250:new TextDecoder('windows-1250',{fatal:true}),
  cp1251:new TextDecoder('windows-1251',{fatal:true}),
  greek:new TextDecoder('iso-8859-7',{fatal:true}),
  latin5:new TextDecoder('iso-8859-9',{fatal:true}),
  hebrew:new TextDecoder('iso-8859-8',{fatal:true}),
  cp1256:new TextDecoder('windows-1256',{fatal:true})
};

/** The mysql server transmits UCS-2 and UTF-16 in big-endian byte order. */
function decodeUtf16(bytes:Buffer,little:boolean,ucs2:boolean):string{
  if(bytes.length%2!==0)throw Error('Malformed MySQL UTF-16 code unit length');
  let value='';
  for(let pos=0;pos<bytes.length;pos+=2){
    const current=little?bytes.readUInt16LE(pos):bytes.readUInt16BE(pos);
    if(current>=0xd800&&current<=0xdbff){
      if(ucs2||pos+3>=bytes.length)
        throw Error('Unpaired MySQL UTF-16 high surrogate');
      const next=little?bytes.readUInt16LE(pos+2):bytes.readUInt16BE(pos+2);
      if(next<0xdc00||next>0xdfff)
        throw Error('Invalid MySQL UTF-16 surrogate pair');
      value+=String.fromCodePoint(
        0x10000+((current-0xd800)<<10)+(next-0xdc00));
      pos+=2;
    }else{
      if(current>=0xdc00&&current<=0xdfff)
        throw Error('Unpaired MySQL UTF-16 low surrogate');
      value+=String.fromCharCode(current);
    }
  }
  return value;
}

/** Validate every Unicode scalar before exposing UTF-32 text to callers. */
function decodeUtf32(bytes:Buffer):string{
  if(bytes.length%4!==0)throw Error('Malformed MySQL UTF-32 code unit length');
  let value='';
  for(let pos=0;pos<bytes.length;pos+=4){
    const cp=bytes.readUInt32BE(pos);
    if(cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))
      throw Error('Invalid MySQL UTF-32 Unicode scalar');
    value+=String.fromCodePoint(cp);
  }
  return value;
}

function ascii(bytes:Buffer):string{
  for(const byte of bytes)if(byte>0x7f)
    throw Error('Non-ASCII byte in MySQL ASCII column');
  return bytes.toString('ascii');
}

/** Decode one textual value or throw. Binary (63) stays a Buffer upstream. */
export function decodeMysqlText(bytes:Buffer,collation:number):string{
  // MySQL 8.x utf8mb3/utf8mb4 explicit known IDs and UCA ranges.
  if(collation===33||collation===45||collation===46||collation===83||
    collation===255||
    (collation>=192&&collation<=215)||
    (collation>=224&&collation<=247)||
    (collation>=256&&collation<=309))
    return utf8.decode(bytes);
  // MySQL's latin1 is Windows codepage 1252, not ISO-8859-1.
  if(collation===5||collation===8||collation===15||collation===31||
     collation===47||collation===48||collation===49||collation===94)
    return western.decode(bytes);
  if(collation===11||collation===65)return ascii(bytes);

  const name=additional.get(collation);
  if(name===undefined)
    throw Error('Unsupported MySQL result character-set collation '+collation);
  switch(name){
    case 'ucs2':return decodeUtf16(bytes,false,true);
    case 'utf16':return decodeUtf16(bytes,false,false);
    case 'utf16le':return decodeUtf16(bytes,true,false);
    case 'utf32':return decodeUtf32(bytes);
    default:return legacyDecoders[name].decode(bytes);
  }
}
