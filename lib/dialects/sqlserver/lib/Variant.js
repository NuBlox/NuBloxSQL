'use strict';

var Collation=require('./Collation');

var TYPES=Object.freeze({
  GUID:0x24,DATE:0x28,TIME:0x29,DATETIME2:0x2a,DATETIMEOFFSET:0x2b,
  INT1:0x30,BIT:0x32,INT2:0x34,INT4:0x38,DATETIME4:0x3a,FLT4:0x3b,MONEY:0x3c,DATETIME:0x3d,FLT8:0x3e,
  DECIMALN:0x6a,NUMERICN:0x6c,MONEY4:0x7a,INT8:0x7f,
  BIGVARBINARY:0xa5,BIGVARCHAR:0xa7,BIGBINARY:0xad,BIGCHAR:0xaf,NVARCHAR:0xe7,NCHAR:0xef
});
var BASE_DATE_MS=-62135596800000;
var DAY_MS=86400000;

function need(buffer,offset,count,label){if(offset+count>buffer.length)throw new RangeError('Incomplete SQL Server '+label);}
function pad(value,length){return String(value).padStart(length,'0');}
function pow10(scale){var result=1n;for(var i=0;i<scale;i++)result*=10n;return result;}
function readUnsignedBigIntLE(buffer,offset,length){need(buffer,offset,length,'sql_variant unsigned integer');var value=0n;for(var i=length-1;i>=0;i--)value=(value<<8n)|BigInt(buffer[offset+i]);return value;}
function readMoney64(buffer,offset){need(buffer,offset,8,'sql_variant MONEY');return(BigInt(buffer.readInt32LE(offset))<<32n)+BigInt(buffer.readUInt32LE(offset+4));}
function formatScaledInteger(value,scale){var negative=value<0n,magnitude=negative?-value:value,digits=magnitude.toString();if(scale>0){if(digits.length<=scale)digits='0'.repeat(scale-digits.length+1)+digits;digits=digits.slice(0,-scale)+'.'+digits.slice(-scale);}return(negative?'-':'')+digits;}
function formatDate(days){var date=new Date(BASE_DATE_MS+(days*DAY_MS));if(!Number.isFinite(date.getTime()))throw new RangeError('SQL Server sql_variant date is outside JavaScript calendar formatting range');return pad(date.getUTCFullYear(),4)+'-'+pad(date.getUTCMonth()+1,2)+'-'+pad(date.getUTCDate(),2);}
function timeLength(scale){return scale<=2?3:(scale<=4?4:5);}
function formatTime(units,scale){var divisor=pow10(scale),whole=units/divisor,fraction=units%divisor,hours=whole/3600n,minutes=(whole%3600n)/60n,seconds=whole%60n,result=pad(hours.toString(),2)+':'+pad(minutes.toString(),2)+':'+pad(seconds.toString(),2);if(scale>0)result+='.'+fraction.toString().padStart(scale,'0');return result;}
function legacyDateTime(buffer,offset,type){if(type===TYPES.DATETIME4){need(buffer,offset,4,'sql_variant SMALLDATETIME');var days=buffer.readUInt16LE(offset),minutes=buffer.readUInt16LE(offset+2),date=new Date(Date.UTC(1900,0,1)+(days*DAY_MS)+(minutes*60000));return pad(date.getUTCFullYear(),4)+'-'+pad(date.getUTCMonth()+1,2)+'-'+pad(date.getUTCDate(),2)+'T'+pad(date.getUTCHours(),2)+':'+pad(date.getUTCMinutes(),2)+':00';}need(buffer,offset,8,'sql_variant DATETIME');var dayCount=buffer.readInt32LE(offset),ticks=buffer.readUInt32LE(offset+4),totalMillis=Math.round(ticks*1000/300),value=new Date(Date.UTC(1900,0,1)+(dayCount*DAY_MS)+totalMillis);return pad(value.getUTCFullYear(),4)+'-'+pad(value.getUTCMonth()+1,2)+'-'+pad(value.getUTCDate(),2)+'T'+pad(value.getUTCHours(),2)+':'+pad(value.getUTCMinutes(),2)+':'+pad(value.getUTCSeconds(),2)+'.'+pad(value.getUTCMilliseconds(),3);}
function guid(buffer,offset){need(buffer,offset,16,'sql_variant GUID');var a=buffer.readUInt32LE(offset).toString(16).padStart(8,'0'),b=buffer.readUInt16LE(offset+4).toString(16).padStart(4,'0'),c=buffer.readUInt16LE(offset+6).toString(16).padStart(4,'0'),d=buffer.subarray(offset+8,offset+10).toString('hex'),e=buffer.subarray(offset+10,offset+16).toString('hex');return a+'-'+b+'-'+c+'-'+d+'-'+e;}
function exactLength(actual,expected,label){if(actual!==expected)throw new RangeError('Invalid SQL Server sql_variant '+label+' length '+actual+', expected '+expected);}

function decodeTemporal(type,scale,data){if(scale>7)throw new RangeError('Invalid SQL Server sql_variant temporal scale '+scale);var tlen=timeLength(scale),expected=type===TYPES.TIME?tlen:(type===TYPES.DATETIME2?tlen+3:tlen+5);exactLength(data.length,expected,'temporal');var units=readUnsignedBigIntLE(data,0,tlen),cursor=tlen;if(type===TYPES.TIME)return formatTime(units,scale);var days=Number(readUnsignedBigIntLE(data,cursor,3));cursor+=3;if(type===TYPES.DATETIME2)return formatDate(days)+'T'+formatTime(units,scale);var zone=data.readInt16LE(cursor),perSecond=pow10(scale),perDay=86400n*perSecond,localTotal=BigInt(days)*perDay+units+BigInt(zone)*60n*perSecond,localDays=localTotal/perDay,localUnits=localTotal%perDay;if(localUnits<0n){localUnits+=perDay;localDays-=1n;}var sign=zone<0?'-':'+';var abs=Math.abs(zone);return formatDate(Number(localDays))+'T'+formatTime(localUnits,scale)+sign+pad(Math.floor(abs/60),2)+':'+pad(abs%60,2);}

function decodeInstance(instance){
  if(instance.length<3)throw new RangeError('Invalid SQL Server sql_variant instance length '+instance.length);
  var baseType=instance[0],propBytes=instance[1];
  if(2+propBytes>=instance.length)throw new RangeError('Invalid SQL Server sql_variant property length '+propBytes);
  var props=instance.subarray(2,2+propBytes),data=instance.subarray(2+propBytes),value,metadata={baseType:baseType,propertyBytes:propBytes};
  if([TYPES.GUID,TYPES.BIT,TYPES.INT1,TYPES.INT2,TYPES.INT4,TYPES.INT8,TYPES.DATETIME,TYPES.DATETIME4,TYPES.FLT4,TYPES.FLT8,TYPES.MONEY,TYPES.MONEY4,TYPES.DATE].indexOf(baseType)!==-1){
    exactLength(propBytes,0,'property');
    if(baseType===TYPES.GUID){exactLength(data.length,16,'GUID');value=guid(data,0);}
    else if(baseType===TYPES.BIT){exactLength(data.length,1,'BIT');value=data[0]!==0;}
    else if(baseType===TYPES.INT1){exactLength(data.length,1,'TINYINT');value=data[0];}
    else if(baseType===TYPES.INT2){exactLength(data.length,2,'SMALLINT');value=data.readInt16LE(0);}
    else if(baseType===TYPES.INT4){exactLength(data.length,4,'INT');value=data.readInt32LE(0);}
    else if(baseType===TYPES.INT8){exactLength(data.length,8,'BIGINT');value=data.readBigInt64LE(0);}
    else if(baseType===TYPES.FLT4){exactLength(data.length,4,'REAL');value=data.readFloatLE(0);}
    else if(baseType===TYPES.FLT8){exactLength(data.length,8,'FLOAT');value=data.readDoubleLE(0);}
    else if(baseType===TYPES.MONEY){exactLength(data.length,8,'MONEY');value=formatScaledInteger(readMoney64(data,0),4);}
    else if(baseType===TYPES.MONEY4){exactLength(data.length,4,'SMALLMONEY');value=formatScaledInteger(BigInt(data.readInt32LE(0)),4);}
    else if(baseType===TYPES.DATETIME||baseType===TYPES.DATETIME4){value=legacyDateTime(data,0,baseType);}
    else if(baseType===TYPES.DATE){exactLength(data.length,3,'DATE');value=formatDate(Number(readUnsignedBigIntLE(data,0,3)));}
  } else if(baseType===TYPES.TIME||baseType===TYPES.DATETIME2||baseType===TYPES.DATETIMEOFFSET){
    exactLength(propBytes,1,'temporal property');metadata.scale=props[0];value=decodeTemporal(baseType,props[0],data);
  } else if(baseType===TYPES.DECIMALN||baseType===TYPES.NUMERICN){
    exactLength(propBytes,2,'decimal property');var precision=props[0],scale=props[1];if(precision<1||precision>38||scale>precision)throw new RangeError('Invalid SQL Server sql_variant decimal precision/scale');if([5,9,13,17].indexOf(data.length)===-1)throw new RangeError('Invalid SQL Server sql_variant decimal data length '+data.length);var sign=data[0];if(sign!==0&&sign!==1)throw new RangeError('Invalid SQL Server sql_variant decimal sign '+sign);var magnitude=readUnsignedBigIntLE(data,1,data.length-1);metadata.precision=precision;metadata.scale=scale;value=formatScaledInteger(sign===0?-magnitude:magnitude,scale);
  } else if(baseType===TYPES.BIGVARBINARY||baseType===TYPES.BIGBINARY){
    exactLength(propBytes,2,'binary property');var maxBinary=props.readUInt16LE(0);if(data.length>maxBinary)throw new RangeError('SQL Server sql_variant binary value exceeds declared maximum length');metadata.maxLength=maxBinary;value=Buffer.from(data);
  } else if([TYPES.BIGVARCHAR,TYPES.BIGCHAR,TYPES.NVARCHAR,TYPES.NCHAR].indexOf(baseType)!==-1){
    exactLength(propBytes,7,'character property');var collation=Buffer.from(props.subarray(0,5)),maxLength=props.readUInt16LE(5),collationInfo=Collation.parse(collation);if(data.length>maxLength)throw new RangeError('SQL Server sql_variant character value exceeds declared maximum length');metadata.maxLength=maxLength;metadata.collation=collation;metadata.collationInfo=collationInfo;if(baseType===TYPES.NVARCHAR||baseType===TYPES.NCHAR){if((data.length&1)!==0)throw new RangeError('SQL Server sql_variant Unicode value has odd byte length');value=data.toString('utf16le');}else value=Collation.decode(collationInfo,data);
  } else throw new RangeError('Unsupported SQL Server sql_variant base type 0x'+baseType.toString(16).padStart(2,'0'));
  return Object.freeze({value:value,metadata:Object.freeze(metadata)});
}

function read(buffer,offset,maxLength){
  need(buffer,offset,4,'sql_variant length');var length=buffer.readInt32LE(offset);offset+=4;
  if(length===0)return{value:null,metadata:null,offset:offset};
  if(length<0)throw new RangeError('Invalid SQL Server sql_variant length '+length);
  if(maxLength!==undefined&&maxLength!==null&&length>maxLength)throw new RangeError('SQL Server sql_variant exceeds declared maximum length');
  need(buffer,offset,length,'sql_variant value');var decoded=decodeInstance(buffer.subarray(offset,offset+length));return{value:decoded.value,metadata:decoded.metadata,offset:offset+length};
}

exports.TYPES=TYPES;
exports.decodeInstance=decodeInstance;
exports.read=read;
