/** Cloud connection catalogue and credential-free planning; never a live qualification claim. */
export type CloudConnectionMethod = 'direct-tcp' | 'external-proxy' | 'service-api';
export interface CloudDatabaseService {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly engine: string;
  readonly deployment: 'managed-cloud' | 'cloud-api' | 'cloud-hosted';
  readonly connectionMethod: CloudConnectionMethod;
  readonly defaultPort: number | null;
  /** SQL wire-protocol candidate only; does not imply cloud credentials or TLS support. */
  readonly existingSqlAdapter: 'postgresql' | 'mysql' | 'sqlserver' | null;
  readonly qualification: 'cloud-unqualified';
  readonly requirements: Readonly<{
    providerIdentity: 'separately-configured';
    databaseAuthentication: 'separately-configured';
    endpointNetworkAccess: 'must-be-established-by-caller';
    transportSecurity: 'must-be-verified-by-caller';
    automaticTokenRefresh: false;
    automaticProxyManagement: false;
  }>;
  readonly limitation: string;
}
export interface CloudDatabaseConnectionPlan {
  readonly schemaVersion: 1;
  readonly serviceId: string;
  readonly status: 'not-implemented' | 'requires-external-network-auth-and-tls-qualification';
  /** NOT a complete connection config; credentials, TLS and network setup must be supplied separately. */
  readonly driverHint: Readonly<{
    dialect: 'postgresql' | 'mysql' | 'sqlserver';
    host: string;
    port: number;
  }> | null;
  readonly requirements: CloudDatabaseService['requirements'];
  readonly limitation: string;
}
export interface CloudDatabaseRegistryApi {
  readonly SCHEMA_VERSION: 1;
  readonly DEPLOYMENT: readonly string[];
  readonly METHODS: readonly CloudConnectionMethod[];
  readonly services: readonly CloudDatabaseService[];
  get(id: string): CloudDatabaseService | null;
  list(options?: Readonly<{
    provider?: string;
    connectionMethod?: CloudConnectionMethod;
    existingSqlAdapter?: boolean;
  }>): readonly CloudDatabaseService[];
  planConnection(options: Readonly<{
    serviceId: string;
    endpoint?: string;
    port?: number;
  }>): CloudDatabaseConnectionPlan;
  report(): Readonly<{
    schemaVersion: 1;
    counts: Readonly<{ services: number; potentialExistingSqlProtocol: number; cloudQualified: 0 }>;
    services: readonly CloudDatabaseService[];
  }>;
  validate(): Readonly<{ schemaVersion: 1; valid: boolean; errors: readonly string[] }>;
}
export const CLOUD_DATABASE_REGISTRY_SCHEMA_VERSION: 1;
export const cloudDatabaseRegistry: CloudDatabaseRegistryApi;
export function planCloudDatabaseConnection(
  input: Parameters<CloudDatabaseRegistryApi['planConnection']>[0]
): CloudDatabaseConnectionPlan;
