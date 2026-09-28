# GTID binary-log resume

NuBloxSQL supports GTID-aware replication requests through the existing dedicated binlog connection surface.

```js
var binlog = require('@nublox/mysql/binlog');
var replication = binlog.createReplicationConnection(config);

var dump = replication.binlogDump({
  filename: 'binlog.000123',
  position: 4n,
  serverId: 41001,
  gtidSet: '24bc7850-2c16-11e6-a073-0242ac110002:1-400'
});
```

Supplying `gtidSet` switches the request from `COM_BINLOG_DUMP` to `COM_BINLOG_DUMP_GTID` and automatically enables `BINLOG_THROUGH_GTID`. Other dump flags, including `BINLOG_DUMP_NON_BLOCK`, are preserved.

## Wire format

NuBloxSQL writes the GTID request as:

1. command byte `COM_BINLOG_DUMP_GTID` (`0x1e`);
2. 16-bit dump flags;
3. 32-bit replica server ID;
4. 32-bit binlog filename byte length;
5. binlog filename bytes;
6. 64-bit binlog position;
7. 32-bit encoded GTID-data length;
8. binary GTID set.

The encoded GTID set contains a 64-bit SID count followed by, for each SID, the 16-byte UUID, 64-bit interval count and pairs of 64-bit interval endpoints. MySQL's text GTID syntax uses inclusive interval ends; the wire representation uses half-open intervals, so `1-3` is encoded as `[1,4)`.

## Validation and bounds

`gtidSet` currently accepts canonical untagged MySQL GTID-set strings. The encoder validates before allocation:

- canonical UUID syntax;
- at least one interval for each SID;
- positive GNOs within the signed 63-bit MySQL GNO range;
- ordered, non-overlapping intervals;
- no duplicate SID entries;
- at most 65,536 SIDs;
- at most 1,048,576 total intervals.

Tagged GTIDs are rejected explicitly until their newer wire representation is implemented and validated across supported MySQL versions.

The GTID request supports a `number` or `bigint` binlog position. Values are serialized as an unsigned 64-bit little-endian integer, avoiding the 32-bit position restriction of the legacy `COM_BINLOG_DUMP` packet.

## Resume semantics

The supplied GTID set describes transactions already executed by the consumer. The source server omits those transactions and streams transactions not represented by the set. Applications should persist a durable checkpoint only after downstream processing has committed successfully.

For long-running production CDC consumers, checkpoint state should eventually include both the GTID set and the current binlog filename/position. The next M7 resume tranche will add a first-class checkpoint/reconnect helper around this transport.

## Compatibility validation

CI validates the packet byte layout and GTID-set encoder deterministically. The live CDC workflow transitions MySQL 8.4 and 9.7 into GTID mode, records the executed set, writes new transactions and verifies that `COM_BINLOG_DUMP_GTID` resumes after that set and yields GTID plus change events.
