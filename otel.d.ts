declare function createOpenTelemetryAdapter(
  options?: createOpenTelemetryAdapter.OpenTelemetryAdapterOptions
): createOpenTelemetryAdapter.OpenTelemetryAdapter;

declare namespace createOpenTelemetryAdapter {
  interface OpenTelemetryAdapterOptions {
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

  interface OpenTelemetryAdapter {
    enable(): OpenTelemetryAdapter;
    disable(): OpenTelemetryAdapter;
    isEnabled(): boolean;
  }

  const createOpenTelemetryAdapter: typeof createOpenTelemetryAdapter;
}

export = createOpenTelemetryAdapter;
