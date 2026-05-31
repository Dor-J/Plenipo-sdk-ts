export interface PlenipoClientOptions {
  didPrivateKey: string;
  relayUrl: string;
}

/**
 * Programmatic client for the Plenipo relay (scaffold).
 */
export class PlenipoClient {
  readonly didPrivateKey: string;
  readonly relayUrl: string;

  constructor(options: PlenipoClientOptions) {
    this.didPrivateKey = options.didPrivateKey;
    this.relayUrl = options.relayUrl;
  }
}
