export interface IStorageService {
  /**
   * Generates a pre-signed URL for uploading a file directly to the storage provider.
   * @param prefix Folder prefix (e.g. "images")
   * @param key Unique file key (e.g. "2024/01/uuid-file.jpg")
   * @param contentType MIME type of the file
   * @param size File size in bytes
   * @param checksumSHA256 Base64 encoded SHA256 checksum of the file
   * @returns Object containing the upload URL and the final key
   */
  getPresignedUploadUrl(
    prefix: string,
    key: string,
    contentType: string,
    size: number,
    checksumSHA256: string,
  ): Promise<{ url: string; key: string }>;

  /**
   * Returns the public URL for a file.
   * Uses CDN if configured, otherwise falls back to direct storage URL.
   */
  getPublicUrl(key: string): string;

  /**
   * Deletes a file from storage.
   */
  delete(key: string): Promise<void>;

  /**
   * Checks if a file exists in storage and returns metadata.
   * Throws an error if not found.
   */
  checkExists(
    key: string,
  ): Promise<{ size: number; mimeType: string; etag: string }>;

  /**
   * Moves a file from sourceKey to destinationKey.
   */
  move(sourceKey: string, destinationKey: string): Promise<void>;

  /**
   * Generates a pre-signed URL for downloading a file.
   * Useful for private buckets.
   */
  getPresignedDownloadUrl(key: string): Promise<string>;
}
