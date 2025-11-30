export interface UploadOptions {
  empresaId: string;
  fileId: string;
  mimeType: string;
  folder?: string;
  transformation?: any;
}

export interface UploadResult {
  url: string;
  proveedorId: string;
  urlThumbnail?: string;
  ancho?: number;
  alto?: number;
}

export interface IStorageProvider {
  /**
   * Sube un archivo al proveedor de storage
   */
  upload(file: Buffer, options: UploadOptions): Promise<UploadResult>;

  /**
   * Elimina un archivo del proveedor de storage
   */
  delete(proveedorId: string, options?: { folder?: string }): Promise<void>;

  /**
   * Obtiene la URL pública de un archivo
   */
  getUrl(proveedorId: string, transformations?: any): string;

  /**
   * Obtiene una URL firmada (temporal) para archivos privados
   */
  getSignedUrl?(
    proveedorId: string,
    expiresIn: number,
  ): Promise<string> | string;
}
