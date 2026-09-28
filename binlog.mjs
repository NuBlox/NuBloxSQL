import createDecoder from './binlog.js';

export const BinlogEventDecoder = createDecoder.BinlogEventDecoder;
export const EventTypes = createDecoder.EventTypes;
export const createReplicationConnection = createDecoder.createReplicationConnection;
export {createDecoder};
export default createDecoder;
