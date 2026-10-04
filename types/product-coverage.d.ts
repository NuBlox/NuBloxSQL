export type ProductCoverageStage =
  | 'publicApi' | 'parser' | 'ast' | 'validator' | 'renderer' | 'rewrite' | 'runtime'
  | 'introspection' | 'diagnostics' | 'contractTest' | 'liveQualification'
  | 'packagedPublic' | 'documentation';

export type ProductCoverageLevel = 'implemented' | 'partial' | 'unsupported' | 'not-applicable';
export type ProductCoverageStatus = 'strong' | 'established' | 'partial' | 'gap';
export type ProductCoveragePillar = 'runtime' | 'language' | 'intelligence' | 'portability' | 'platform' | 'dialect-depth';
export type ProductCoverageDialect = 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver';

export interface ProductCoverageArea {
  readonly id: string;
  readonly pillar: ProductCoveragePillar;
  readonly status: ProductCoverageStatus;
  readonly stages: Readonly<Record<ProductCoverageStage, ProductCoverageLevel>>;
  readonly dialects: Readonly<Record<ProductCoverageDialect, ProductCoverageLevel>>;
  readonly evidence: readonly string[];
  readonly next: string | null;
}

export interface ProductCoverageReport {
  readonly schemaVersion: 2;
  readonly summary: Readonly<{
    total: number;
    strong: number;
    established: number;
    partial: number;
    gap: number;
  }>;
  readonly pillars: Readonly<Partial<Record<ProductCoveragePillar, readonly ProductCoverageArea[]>>>;
  readonly areas: readonly ProductCoverageArea[];
}

export interface ProductCoverageApi {
  readonly SCHEMA_VERSION: 2;
  readonly STAGES: readonly ProductCoverageStage[];
  readonly LEVELS: readonly ProductCoverageLevel[];
  readonly areas: readonly ProductCoverageArea[];
  area(id: string): ProductCoverageArea | null;
  report(): ProductCoverageReport;
  gaps(): readonly ProductCoverageArea[];
  validate(): Readonly<{ valid: true; schemaVersion: 2; areas: number }>;
}

export const PRODUCT_COVERAGE_SCHEMA_VERSION: 2;
export const productCoverage: ProductCoverageApi;

declare module './public' {
  interface SqlCapabilityModelApi {
    readonly productCoverage: ProductCoverageApi;
  }
}
