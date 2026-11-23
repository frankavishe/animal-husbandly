/**
 * Object storage abstraction (S3-compatible in production/dev, in-memory in e2e tests).
 * The abstract class doubles as the Nest DI token.
 */
export abstract class StorageService {
  /** Stores `body` under `key`, replacing any existing object. */
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Deletes the object; deleting a missing key is not an error. */
  abstract delete(key: string): Promise<void>;

  /** Public URL clients can fetch the object from. */
  abstract publicUrl(key: string): string;
}
