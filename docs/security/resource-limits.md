# Resource safety limits

NuBloxSQL applies explicit resource limits at protocol boundaries so a server response cannot force uncontrolled client allocation.

## Inbound logical packet limit

`maxInboundPacketSize` limits the total payload size of one logical inbound MySQL classic-protocol packet.

```js
const mysql = require('@nublox/mysql');

const connection = mysql.createConnection({
  host: '127.0.0.1',
  user: 'app',
  database: 'app',
  maxInboundPacketSize: 64 * 1024 * 1024
});
```

The default is **64 MiB**.

The limit is evaluated from packet headers before the packet payload is handed to the existing packet parser. It applies after connection decompression, so zlib and zstd transport compression cannot bypass the logical packet boundary.

MySQL classic-protocol payloads can span multiple 16,777,215-byte fragments. NuBloxSQL tracks the cumulative logical packet size across those fragments rather than treating each fragment as an independent allocation boundary.

When the declared logical packet size exceeds the configured limit, the connection fails with a fatal error:

```text
PROTOCOL_INBOUND_PACKET_TOO_LARGE
```

The error exposes:

- `limit`: the configured byte limit;
- `packetLength`: the declared cumulative logical packet payload size;
- `fatal: true`.

Applications that legitimately exchange larger BLOBs or other large payloads can raise `maxInboundPacketSize` explicitly. The value must be a positive safe integer.

## M5 resource-safety programme

The logical packet limit is the first M5 boundary. Follow-on work will add independently configurable controls for result columns, field/column payloads, metadata, rows/result sets and other cumulative allocation surfaces. Those limits will be introduced with executable tests rather than inferred from the packet-size setting.
