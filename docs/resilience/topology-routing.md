# Pool topology and routing policy

NuBloxSQL keeps the classic MySQL protocol model of one active command per physical connection. Multi-host routing therefore happens at the pool-cluster boundary, before a physical connection is acquired.

## Node topology metadata

`PoolCluster#add()` accepts optional topology metadata for each named node:

```js
var cluster = mysql.createPoolCluster({
  topologyPolicy: function(candidates, context) {
    if (context.operation === 'query' && /^\s*select\b/i.test(context.sql || '')) {
      return candidates.find(function(node) {
        return node.role === 'replica' && node.replicationState === 'online';
      }).id;
    }

    return candidates.find(function(node) {
      return node.role === 'primary';
    }).id;
  }
});

cluster.add('PRIMARY', primaryPoolConfig, {
  role: 'primary',
  replicationState: 'online',
  priority: 100,
  tags: {region: 'uk'}
});

cluster.add('REPLICA_A', replicaPoolConfig, {
  role: 'replica',
  replicationState: 'online',
  priority: 50,
  weight: 2,
  tags: {region: 'uk', az: 'a'}
});
```

Anonymous nodes can supply metadata as the second argument:

```js
cluster.add(poolConfig, {
  role: 'replica',
  replicationState: 'online'
});
```

Metadata fields are intentionally connector-neutral:

- `role` — for example `primary`, `replica`, `analytics`, or `unknown`;
- `replicationState` — for example `online`, `lagging`, `recovering`, or `unknown`;
- `priority` — application-defined numeric ordering input;
- `weight` — application-defined numeric weighting input;
- `tags` — arbitrary routing metadata such as region or availability zone.

NuBloxSQL normalizes `role` and `replicationState` to lowercase but does not impose vendor-specific role names or replication-state semantics.

## Topology snapshots

`cluster.topology()` returns immutable node snapshots containing connection location, online/offline state, error count, and topology metadata. The snapshot object and copied `tags` object are frozen; callers cannot mutate cluster state through a snapshot.

```js
console.log(cluster.topology());
```

A typical snapshot contains:

```js
{
  id: 'REPLICA_A',
  host: 'db-replica-a.internal',
  port: 3306,
  online: true,
  offlineUntil: 0,
  errorCount: 0,
  role: 'replica',
  replicationState: 'online',
  priority: 50,
  weight: 2,
  tags: {region: 'uk', az: 'a'}
}
```

Update metadata without rebuilding the pool:

```js
cluster.setNodeMetadata('REPLICA_A', {
  replicationState: 'lagging'
});
```

The cluster emits a `topology` event after node addition, removal, metadata changes, and online/offline transitions.

## Topology refresh provider

A `topologyProvider` can refresh metadata for existing cluster nodes from an external discovery or health source without coupling NuBloxSQL to a particular infrastructure vendor:

```js
var cluster = mysql.createPoolCluster({
  topologyProvider: async function(current) {
    var discovered = await serviceDiscovery.lookup(current);

    return discovered.map(function(node) {
      return {
        id: node.id,
        role: node.role,
        replicationState: node.replicationState,
        priority: node.priority,
        tags: node.tags
      };
    });
  }
});

await cluster.refreshTopology();
```

The provider receives an immutable array of immutable topology snapshots and returns an array of metadata updates. Providers may be synchronous or asynchronous.

Refresh has deliberate transactional semantics:

- updates apply only to nodes that already exist in the cluster;
- an unknown node rejects the refresh with `POOL_TOPOLOGY_UNKNOWN_NODE`;
- duplicate node IDs reject the refresh;
- all returned updates are validated before any node metadata is changed, preventing partial refreshes;
- concurrent `refreshTopology()` calls share one in-flight provider invocation;
- `POOL_TOPOLOGY_PROVIDER_MISSING` is returned when refresh is requested without a configured provider.

`refreshTopology(callback)` supports callback consumers and also returns the refresh Promise. A successful refresh emits `topology` and `topologyRefresh`; a failed refresh emits `topologyRefreshError` and rejects without applying partial metadata.

The provider intentionally manages metadata rather than cluster membership. Adding and removing physical endpoints remains explicit so discovery failures cannot silently create pools, delete pools, or introduce credentials/configuration that the application did not supply.

Possible provider sources include DNS/service discovery, Kubernetes, cloud database APIs, a control plane, or the built-in MySQL writability probe described below.

## Built-in MySQL writability probe

`probePoolClusterRoles(cluster)` interrogates every configured cluster node with:

```sql
SELECT @@GLOBAL.read_only, @@GLOBAL.super_read_only
```

and records the observed write policy in topology metadata:

```js
var topology = await mysql.probePoolClusterRoles(cluster);
```

The probe assigns one of two evidence-based roles:

- `writable` when both `read_only` and `super_read_only` are disabled;
- `read-only` when either variable is enabled.

It also preserves existing tags and adds:

```js
{
  mysqlReadOnly: false,
  mysqlSuperReadOnly: false,
  mysqlWritable: true
}
```

The probe collects results from every node before applying any metadata updates. If any connection or probe query fails, no role metadata is changed. Promise and callback use are both supported.

### What the probe deliberately does not claim

MySQL documents `read_only` as a global server write-policy control. `super_read_only` is stricter and, when enabled, also forces `read_only` on. These settings are commonly useful on replicas, but they do not by themselves prove that a server is a replication source or replica, nor do they prove replication health or lag.

For that reason the built-in probe does **not** assign `primary` or `replica`, and it does not change `replicationState`. It records only what the server variables support: whether ordinary client writes are currently permitted by the server's global read-only policy.

Applications can combine this evidence with an external `topologyProvider` that has authoritative replication-state knowledge.

## Topology policy hook

The optional `topologyPolicy(candidates, context)` hook runs only after the cluster has filtered out nodes that are currently offline.

`candidates` contains immutable topology snapshots. `context` currently contains:

- `operation`: `connection` or `query`;
- `pattern`: the pool-cluster namespace pattern;
- `sql`: query text for `query` selection.

The policy may return a candidate ID or candidate object. Returning `null` or `undefined` delegates to the configured legacy selector (`RR`, `RANDOM`, or `ORDER`).

If a policy returns an ID that is not one of the currently eligible candidates, NuBloxSQL throws `POOL_TOPOLOGY_INVALID_SELECTION`. This prevents a routing policy from silently selecting an offline or out-of-pattern node.

## Failover semantics

The existing pool-cluster failure model remains intact:

1. connection acquisition failure increments the node error count;
2. once `removeNodeErrorCount` is reached, the node is either removed or temporarily marked offline according to `restoreNodeTimeout`;
3. retries re-run topology selection against the remaining online candidates;
4. when a temporarily offline node becomes eligible again, it re-enters the candidate set.

This means topology policies are failover-aware without duplicating connection health state.

## Safety boundary

The topology hook is deliberately a selection interface, not automatic SQL classification. Applications that route reads and writes differently should use policy logic appropriate to their transaction model. In particular, a statement beginning with `SELECT` is not automatically safe to send to a replica when session consistency, locking reads, transactions, or replica lag matter.

The refresh-provider and MySQL writability-probe contracts give later M7 discovery and routing capabilities stable integration boundaries without turning partial evidence into unsafe replication assumptions.
