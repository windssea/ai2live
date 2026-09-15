import type { ProviderId } from "./types.js";

export class ProviderNotConfiguredError extends Error {
  readonly provider: ProviderId;
  readonly code = "PROVIDER_NOT_CONFIGURED" as const;

  constructor(provider: ProviderId, message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
    this.provider = provider;
  }
}

export class ProviderBinaryMissingError extends Error {
  readonly provider: ProviderId;
  readonly code = "PROVIDER_BINARY_MISSING" as const;

  constructor(provider: ProviderId, message: string) {
    super(message);
    this.name = "ProviderBinaryMissingError";
    this.provider = provider;
  }
}
