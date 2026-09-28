# Query pipelining and command ordering

## Decision

NuBloxSQL does **not** multiplex overlapping classic-protocol commands on a single MySQL connection.

A connection continues to accept multiple application operations into its driver queue, but only the active command is emitted on the wire. The next command starts after the active sequence ends, at which point the classic and compressed packet sequence counters are reset for the new command.

Concurrency is provided by the connection pool, where independent MySQL sessions can execute work in parallel without violating per-connection protocol state.

## Why

The MySQL client/server protocol is stateful. After authentication, a connection enters the Command Phase. A command starts with a client command packet whose sequence ID starts at zero. MySQL packet sequence IDs are reset when a new command begins.

Official protocol references:

- MySQL Client/Server Protocol: https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html
- MySQL Connection Lifecycle: https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_connection_lifecycle.html
- MySQL Command Phase: https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_command_phase.html
- MySQL packet sequence rules: https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_basic_packets.html

NuBloxSQL's protocol dispatcher mirrors those constraints:

1. `_enqueue()` appends a sequence to `_queue`.
2. `_startSequence()` is called immediately only when the new sequence is the sole queue entry.
3. incoming packets are dispatched exclusively to `_queue[0]`.
4. `_dequeue()` removes the completed sequence, resets packet numbering and only then starts the next sequence.

This ordering is also required by connection-local state such as transactions, session variables, temporary tables, prepared-statement lifecycle and commands whose response shape controls how subsequent packets must be interpreted.

## What is safe

### Single connection

Safe behaviour is ordered command submission:

```text
application:  query A ---- query B ---- query C
                    |          |          |
driver queue:      [A, B, C]  [B, C]     [C]
wire:               A <reply>  B <reply>  C <reply>
```

Applications may enqueue work without awaiting each callback or Promise first, but this is queueing, not wire-level multiplexing.

### Pool

Parallel work should use separate pooled connections:

```text
pool connection 1: A <reply>
pool connection 2: B <reply>
pool connection 3: C <reply>
```

The pool is therefore the supported concurrency boundary for independent operations.

### Prepared statements

Prepare/execute/reset/close sequences remain ordered on the connection. NuBloxSQL's prepared-statement implementation already preserves atomic prepare/execute command ordering, and true command multiplexing would invalidate those guarantees.

## What is intentionally not implemented

The release-candidate line will not add:

- simultaneous in-flight commands on one classic-protocol connection;
- response demultiplexing based on application-generated request IDs, because the classic protocol has no request ID for that purpose;
- speculative transmission of a second command before the previous command response has completed;
- automatic reordering of commands that may depend on connection-local state.

These would create correctness risks without protocol support for associating interleaved response packets with independent requests.

## Future performance work

Future work can improve concurrency without violating protocol ordering by considering:

- pool admission and scheduling improvements;
- explicit parallel helpers that acquire multiple pool connections;
- application-level batching where SQL semantics permit it;
- server-side cursor support for prepared statements where protocol support permits it;
- independent topology-aware connections for read/write routing.

Any future feature described as pipelining must preserve the one-active-command-per-classic-connection invariant unless a different MySQL protocol explicitly supplies safe multiplexing semantics.

## Acceptance test

`test/unit/protocol/test-ProtocolCommandOrdering.js` locks down the invariant that two queued commands emit only the first command initially; completion of the first command starts the second; and each new command begins with packet sequence ID zero.
