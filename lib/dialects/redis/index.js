'use strict';

const {RedisConnection} = require('./lib/Connection');
const {RedisReplyError} = require('./lib/Resp2');
const descriptor = Object.freeze({
  identity: Object.freeze({family:'redis',name:'Redis',status:'initial-native-runtime'}),
  models: Object.freeze(['key-value']),
  nativeInterface:'command-api',
  operations:Object.freeze(['key-value.command']),
  limitations:Object.freeze(['RESP2-only','standalone-only','no-cluster-routing',
    'no-Sentinel','no-PubSub','no-RESP3-push','no-auto-reconnect'])
});
function createConnection(config) {return new RedisConnection(config);}
module.exports = {descriptor,RedisConnection,RedisReplyError,createConnection};
