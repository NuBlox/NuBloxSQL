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

The drift values are evidence, not leak verdicts. V8 heap growth, allocator arenas, JIT warm-up and operating-system RSS behaviour can produce non-zero slopes even when objects are collectible. Compare multiple runs on the same Node.js version and machine before using the numbers to justify a buffer-reuse change.

CI runs a deliberately small smoke configuration on Node 24. It verifies that the profiler stays executable and that both hot paths complete correctly; hosted-runner memory values are not used as performance thresholds.
