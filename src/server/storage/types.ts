export interface FileMeta {
  originalName: string;
  contentType?: string | null;
  size?: number;
}

export interface FileStore {
  readonly name: string;
  readonly isDurable: boolean;
  put(buffer: Buffer, meta: FileMeta): Promise<string>;
  putWithId(storedName: string, buffer: Buffer, meta?: FileMeta): Promise<void>;
  get(storedName: string): Promise<Buffer | null>;
  delete(storedName: string): Promise<boolean>;
  exists(storedName: string): Promise<boolean>;
  list?(): Promise<string[]>;
}
