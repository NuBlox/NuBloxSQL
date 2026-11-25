# WP00 — Native Classic protocol clause traceability, part 1

Audited source revision: [302d1378a3f40f8b1402b8df445829e9909b1341](https://github.com/NuBlox/NuBloxSQL/commit/302d1378a3f40f8b1402b8df445829e9909b1341). Parent programme [#490](https://github.com/NuBlox/NuBloxSQL/issues/490); capability register [MYSQL-CAPABILITY-BASELINE.md](MYSQL-CAPABILITY-BASELINE.md). This is a focused implementation/test review of the foundational scalar and response packet clauses, not a complete protocol compliance certification. MySQL 8.4.11 official documentation is the pinned reference; verify relevant differences for other qualified versions. No competing driver source used.

Status: Covered = inspected source and named assertions address the stated clause within the negotiated profile; Partial = a known implementation or evidence gap; Excluded = deliberately unnegotiated or not implemented. No status is commercial release approval. The named tests were inspected, not rerun during this review; fresh PR CI is required.

## Specification references (reviewed 2026-11-25)

- [I: integer encoding](https://dev.mysql.com/doc/dev/mysql-server/8.4.11/page_protocol_basic_dt_integers.html)
- [O: OK packet](https://dev.mysql.com/doc/dev/mysql-server/8.4.11/page_protocol_basic_ok_packet.html)
- [R: ERR packet](https://dev.mysql.com/doc/dev/mysql-server/8.4.11/page_protocol_basic_err_packet.html)
- [E: EOF packet](https://dev.mysql.com/doc/dev/mysql-server/8.4.11/page_protocol_basic_eof_packet.html)
- [C: column definition](https://dev.mysql.com/doc/dev/mysql-server/8.4.11/page_protocol_com_query_response_text_resultset_column_definition.html)

All descriptions below are original engineering requirements derived from these wire contracts, with separate local policy restrictions explicitly identified.

## Clause-to-test mapping

Paths abbreviated: source root packages/driver/src/vendors/mysql; test root packages/driver/tests. Test names quoted from our own repository.

| ID / capability | Required behaviour and reference | Source | Inspected test / assertion | Assessment |
|---|---|---|---|---|
| P001 / C05 | I: unsigned little-endian scalar reads (1, 2, 3, 4, 8 bytes) | protocol/primitives.ts Cursor | mysql-cursor-scalar-read.test.mjs: fixed-width and length-coded fields decode without allocating buffer views; exact 8-byte max and 24-bit 65536 case | Covered for these widths; 6-byte generic reader not exposed |
| P002 / C05 | I: scalar truncation rejects before consuming incomplete value | protocol/primitives.ts Cursor.advance | same file: every truncated scalar and length prefix fails at the field boundary; checks cursor position | Covered |
| P003 / C05 | I: length-coded integer boundaries including 250/251, 65535/65536, 16777215/16777216 and max uint64 | protocol/primitives.ts Cursor.len, size | same scalar test: 250,251,65536,MAX_SAFE_INTEGER; codec.test.mjs existing prepared binding assertions | Partial: exhaustive transition encode/decode tests needed; integer decoder currently limits to safe number |
| P004 / C05,C15 | I: 0xFE integer prefix requires eight following bytes; distinguish response markers in command context | protocol/primitives.ts Cursor.len; protocol/results.ts eofStatus | scalar truncation test includes all 0xFE prefix lengths; result-boundaries.test.mjs EOF flags test rejects short/extra EOF | Covered at parser level |
| P005 / C14 | Length-prefixed variable fields retain empty bytes versus NULL; no read beyond packet | protocol/primitives.ts Cursor.lbytes; text-results.ts | mysql-cursor-scalar-read.test.mjs: length-coded payloads retain zero-copy and NULL semantics; mysql-text-results.test.mjs: NULL markers and empty byte strings are different text values | Covered at selected primitive and text-row level |
| P006 / C15 | O: command OK includes two length-coded counts plus status and warnings for Protocol 4.1 | protocol/results.ts parseOkPacket | result-boundaries.test.mjs: critical command acknowledgements require complete Classic protocol 4.1 OK fields; all short prefixes, NULL counts, status, warning checks | Covered except full uint64 fidelity (P007) |
| P007 / C15 | O + I: both acknowledgement counts support full unsigned 64-bit wire range | protocol/results.ts parseOkPacket; protocol/primitives.ts Cursor.len; core/contracts.ts QueryResult | scalar test explicitly expects rejection above MAX_SAFE_INTEGER; existing OK tests use small values | Partial: valid large insert ID currently treated as malformed acknowledgement. WP10 priority; do not conflate allocation lengths with numeric values |
| P008 / C11,C15 | O: result-continuation status accepted only on permitted multi-result path | protocol/results.ts ok, acknowledgedOk, assertSingleResult | result-boundaries.test.mjs: prepared statement OK cannot claim SQL success without complete Protocol 4.1 fields; checks status 8 accepted only with allowMultiple | Covered for tested status |
| P009 / C15 | O: EOF-replacement OK and session-track data are negotiated features | protocol/handshake.ts flags; protocol/results.ts parseOkPacket | inspected flags omit CLIENT_DEPRECATE_EOF and CLIENT_SESSION_TRACK; ordinary OK test accepts optional info | Excluded: no claim of support for these alternative layouts |
| P010 / C23 | R: 0xFF response, LE16 vendor code, marker and five-byte SQLSTATE, remainder message | protocol/results.ts errorPacket; errors.ts | result-boundaries.test.mjs: Protocol 4.1 server errors require a complete marked five-byte SQLSTATE; validates vendor code/state, message, invalid lengths/markers/high bits | Covered for inspected structure; separate message encoding/redaction audit remains |
| P011 / C15 | E: negotiated legacy result terminator includes warning and status fields | protocol/results.ts eofStatus | result-boundaries.test.mjs: EOF flags and warnings are parsed strictly: no silent extra results; exact size and wrong marker rejected | Covered; EOF replacement unnegotiated |
| P012 / C12 | C: six length-prefixed metadata names with original and display identity | protocol/results.ts field | result-boundaries.test.mjs: MySQL protocol 4.1 metadata keeps physical column origin, name and alias; rejects trailing bytes | Covered for origin; catalog value/UTF-8 validation review remains |
| P013 / C12 | C: metadata name fields are not row NULLs; zero-length strings permitted | protocol/results.ts field; metadata.ts | result-boundaries.test.mjs: ColumnDefinition41 rejects NULL markers in all six required metadata strings; both parser and consumer, empty strings accepted | Covered |
| P014 / C12 | C: fixed metadata fields retain charset, width, type, flags, decimals and fixed-section size | protocol/results.ts field | result-boundaries.test.mjs origin fixture includes these fields but does not independently assert every field or reserved bytes | Partial: add field-by-field boundary and truncation tests; verify reserved-byte semantics before tightening |
| P015 / C20,C22 | Local policy: metadata and result allocation independently bounded; malformed response revokes connection without injecting cleanup command | metadata.ts; adapter.ts | result-boundaries.test.mjs: cumulative column metadata bytes are limited before a second oversized definition is decoded; mysql-result-header-fail-closed.test.mjs: malformed binary result header revokes native session; cursor malformed metadata/EOF tests check socket destroyed and no COM_STMT_CLOSE | Covered for inspected policy cases; not a MySQL wire requirement |

## WP10 first actionable correctness gap

For P007, the current bounded length reader is also used for acknowledgement counters. The two contexts have different requirements: buffer sizes must remain bounded and exactly representable as numbers, whereas the server's affected-row and insert-ID fields can carry unsigned 64-bit numeric values. An acknowledged write may have already committed when the parser rejects its valid large identifier. A fix must preserve successful acknowledgements, avoid silent rounding, and explicitly preserve or version public API semantics.

Acceptance: exact values for 0, 250, 251, 65535, 65536, 16777215, 16777216, 2^53-1, 2^53, and 2^64-1 in either count; truncated and invalid markers rejected; unchanged allocation guards and small-value results; real MySQL BIGINT UNSIGNED AUTO_INCREMENT insert above 2^53 followed by exact query and same-session reuse; audit affectedRows/insertId consumers, public contract lock and serialisation. No implementation decision approved by this document.

## Remaining WP00 traceability

Next inspect handshake/flag negotiation and authentication; frame boundaries/sequence resets; text and prepared command layouts; binary and text row types/collations; cursor and multi-result state transitions. Link each exact specification clause and concrete assertion, including unsupported combinations and evidence limitations. Reconcile historical status documents without changing commercial approval. Original benchmark ZIP checksum verification remains open. Do not mark WP00 complete solely from this first clause set.
