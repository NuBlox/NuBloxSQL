# Memory soak benchmark

Run the long-duration parser and PacketWriter memory profile with:

```sh
npm run benchmark:memory-soak
```

The benchmark repeatedly exercises two allocation-sensitive hot paths:

1. fragmented classic-protocol packet parsing; and
2. PacketWriter payload growth and final packet framing.

The process is started with `--expose-gc`. Each cycle records a pre-GC peak sample and a post-GC settled sample. The final JSON report includes:

- mean, p50 and p95 cycle duration;
- peak RSS, heap, external and ArrayBuffer deltas from the baseline;
- settled RSS, heap, external and ArrayBuffer deltas after the final cycle; and
- least-squares settled-memory drift in bytes per cycle for each memory category.

Environment variables:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `BENCHMARK_MEMORY_CYCLES` | `50` | Number of repeated cycles for each workload. |
| `BENCHMARK_MEMORY_PARSER_PACKETS` | `10000` | Classic-protocol packets parsed per cycle. |
| `BENCHMARK_MEMORY_PARSER_PAYLOAD_BYTES` | `32` | Payload bytes per parser packet. |
| `BENCHMARK_MEMORY_PARSER_CHUNK_BYTES` | `16` | Fragment size fed to the parser. |
| `BENCHMARK_MEMORY_WRITER_BYTES` | `1048576` | Payload bytes framed by PacketWriter per cycle. |
| `BENCHMARK_MEMORY_WRITER_CHUNK_BYTES` | `64` | Application write chunk size used to build the PacketWriter payload. |

## PacketWriter headroom result

The first evidence-led output-buffer optimisation reserves the classic four-byte packet header at the start of the PacketWriter backing buffer. For the common single-packet path, final framing writes the header into that reserved space and returns a view of the existing buffer instead of allocating and copying the whole payload again.

The Node 24 CI smoke configuration uses a 128 KiB writer payload. Before this change, its peak external and ArrayBuffer delta was 425,988 bytes. With header-headroom reuse it was 298,496 bytes: 127,492 fewer bytes, closely matching the payload-sized framing allocation that the change removes. The settled ArrayBuffer delta remained zero in both runs.

The same hosted-runner smoke also showed lower PacketWriter cycle time and higher throughput, but timing values from different hosted CI runners are too noisy to treat as a performance guarantee. The allocation reduction is the primary evidence for this change because it follows directly from the eliminated copy and matches the measured external-memory difference.

The drift values are evidence, not leak verdicts. V8 heap growth, allocator arenas, JIT warm-up and operating-system RSS behaviour can produce non-zero slopes even when objects are collectible. Compare multiple runs on the same Node.js version and machine before using the numbers to justify another buffer-reuse change.

CI runs a deliberately small smoke configuration on Node 24. It verifies that the profiler stays executable and that both hot paths complete correctly; hosted-runner memory values are not used as performance thresholds.
