import type { DecoderStrategy } from "../decoders/decoder.interface";

/**
 * Registry of versioned decoders.
 *
 * Maps schema version numbers to DecoderStrategy implementations.
 * Falls back to the closest lower version if an exact match is not found.
 */
export class LoaderRegistry {
  private readonly loaders = new Map<number, DecoderStrategy>();

  /** Register a decoder for a specific schema version. */
  register(version: number, decoder: DecoderStrategy): void {
    this.loaders.set(version, decoder);
  }

  /**
   * Get the decoder for a specific schema version.
   *
   * If no exact match exists, falls back to the closest lower registered version.
   * Throws if no suitable decoder can be found.
   */
  getLoader(version: number): DecoderStrategy {
    if (this.loaders.has(version)) {
      return this.loaders.get(version)!;
    }

    // Fallback: find the closest lower version
    const versions = Array.from(this.loaders.keys()).sort((a, b) => b - a);
    const fallback = versions.find((v) => v <= version);

    if (fallback !== undefined) {
      return this.loaders.get(fallback)!;
    }

    throw new Error(`No loader registered for schema version ${version}`);
  }

  /** Check if a decoder is registered for the given version. */
  hasLoader(version: number): boolean {
    return this.loaders.has(version);
  }

  /** Get all registered version numbers in ascending order. */
  getVersions(): number[] {
    return Array.from(this.loaders.keys()).sort((a, b) => a - b);
  }

  /** Get the latest (highest) registered version number. Returns 0 if empty. */
  getLatestVersion(): number {
    const versions = this.getVersions();
    return versions.length > 0 ? versions[versions.length - 1] : 0;
  }
}
