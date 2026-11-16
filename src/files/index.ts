// Public entry for the file service: uploads checked for type and size,
// downloads authorized on the server, both recorded.
export { ALLOWED_EXTENSIONS, checkUpload, formatSize, MAX_FILE_BYTES, type FileRecord, type UploadError } from "./domain/file.ts";
export { openFile, openFileForClient, saveFile, type BlobStore, type FileRecordStore, type FilesDeps, type NewFile, type OpenedFile } from "./application/files.ts";
