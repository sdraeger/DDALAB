// The synchronous file API of workers (OPFS), which TypeScript's DOM library does not declare.
interface FileSystemSyncAccessHandle {
  read(buffer: AllowSharedBufferSource, options?: { at?: number }): number;
  write(buffer: AllowSharedBufferSource, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

declare var FileSystemSyncAccessHandle: { prototype: FileSystemSyncAccessHandle };

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}
