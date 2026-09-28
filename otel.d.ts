export interface OpenTelemetryAdapterOptions {
  api?: any;
  tracer?: any;
  meter?: any;
  instrumentationName?: string;
  instrumentationVersion?: string;
  database?: string;
  host?: string;
  port?: number;
  captureQueryText?: boolean;
}

export interface OpenTelemetryAdapter {
  enable(): OpenTelemetryAdapter;
  disable(): OpenTelemetryAdapter;
  isEnabled(): boolean;
}

export declare function createOpenTelemetryAdapter(options?: OpenTelemetryAdapterOptions): OpenTelemetryAdapter;

declare const createAdapter: typeof createOpenTelemetryAdapter;
export = createAdapter;
