'use strict';

const {MongoNativeConnection} = require('./lib/Connection');
const descriptor=Object.freeze({
  identity:Object.freeze({family:'mongodb',name:'MongoDB',status:'initial-native-runtime'}),
  models:Object.freeze(['document']),
  nativeInterface:'document-api',
  operations:Object.freeze(['document.read','document.write']),
  limitations:Object.freeze(['optional-official-driver-required','direct-host-only',
    'no-SRV-discovery','no-transaction-api','no-change-streams','no-native-admin-interface'])
});
function createConnection(config) {return new MongoNativeConnection(config);}
module.exports=Object.freeze({descriptor,MongoNativeConnection,createConnection});
