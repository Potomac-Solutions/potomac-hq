// The file service. Storing and reading a file each check permission and
// write an activity event (roadmap v0.3: "authorize every download on the
// server, and record uploads and downloads as activity events").
import { checkUpload, CLIENT_UPLOAD, MAX_CLIENT_FILES_A_DAY, type FileRecord, type UploadError } from "../domain/file.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type FileRecordStore = {
  insert(record: FileRecord, at: string): void;
  get(id: Id): FileRecord | null;
  setClientVisible(id: Id, visible: boolean): void;
  remove(id: Id): void;
  /** The files filed under one owner, newest first, with when each was stored and who at the client sent it. */
  listForOwner(ownerType: string, ownerId: Id): (FileRecord & { readonly createdAt: string; readonly clientUserName: string | null })[];
};

export type BlobStore = {
  put(fileId: Id, body: Uint8Array): void;
  get(fileId: Id): Uint8Array | null;
  remove(fileId: Id): void;
};

export type FilesDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly files: FileRecordStore;
  readonly blobs: BlobStore;
  /** SHA-256 of the bytes, as lower-case hex. */
  readonly digest: (bytes: Uint8Array) => string;
};

export type NewFile = {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly ownerType: string;
  readonly ownerId: Id;
  readonly organizationId: Id | null;
  /** Put in the event, so a project's history shows the upload. */
  readonly projectId?: Id | null;
};

/**
 * Stores one file. Call it inside the transaction of the use case that owns
 * the file (a deliverable, a receipt), so the file and its owner are saved
 * together or not at all.
 */
export function saveFile(deps: FilesDeps, actorId: Id | null, input: NewFile | null): Result<FileRecord, "forbidden" | UploadError> {
  if (actorId === null || !authorize(deps, actorId, "file.upload").ok) return err("forbidden");
  const checked = checkUpload(input);
  if (!checked.ok || !input) return checked.ok ? err("file-missing") : checked;
  const record: FileRecord = {
    id: deps.newId(),
    name: checked.value.name,
    contentType: checked.value.contentType,
    sizeBytes: input.bytes.length,
    sha256: deps.digest(input.bytes),
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    organizationId: input.organizationId,
    clientVisible: false,
    uploadedBy: actorId,
  };
  deps.files.insert(record, deps.clock());
  deps.blobs.put(record.id, input.bytes);
  recordActivity(deps, {
    actorId,
    action: "file.uploaded",
    recordType: "file",
    recordId: record.id,
    context: { name: record.name, sizeBytes: record.sizeBytes, ownerType: record.ownerType, ownerId: record.ownerId, ...(input.projectId ? { projectId: input.projectId } : {}) },
  });
  return ok(record);
}

/**
 * Deletes one file, its bytes and its record. Like saveFile, call it inside
 * the transaction of the use case that owns the file, after that use case has
 * checked the file is its own. The event keeps its name, size and hash.
 */
export function removeFile(deps: FilesDeps, actorId: Id | null, record: FileRecord, projectId: Id | null = null): Result<FileRecord, "forbidden"> {
  if (actorId === null || !authorize(deps, actorId, "file.upload").ok) return err("forbidden");
  deps.blobs.remove(record.id);
  deps.files.remove(record.id);
  recordActivity(deps, {
    actorId,
    action: "file.removed",
    recordType: "file",
    recordId: record.id,
    context: { name: record.name, sizeBytes: record.sizeBytes, sha256: record.sha256, ownerType: record.ownerType, ownerId: record.ownerId, ...(projectId ? { projectId } : {}) },
  });
  return ok(record);
}

export type OpenedFile = { readonly record: FileRecord; readonly body: Uint8Array };

/** A file for a signed-in HQ user to download. Permission: `file.download`. */
export function openFile(deps: FilesDeps, actorId: Id | null, fileId: Id): Result<OpenedFile, "forbidden" | "not-found"> {
  if (actorId === null || !authorize(deps, actorId, "file.download").ok) return err("forbidden");
  return deps.transact(() => {
    const record = deps.files.get(fileId);
    const body = record ? deps.blobs.get(fileId) : null;
    if (!record || !body) return err("not-found");
    recordActivity(deps, { actorId, action: "file.downloaded", recordType: "file", recordId: fileId, context: { name: record.name, by: "user" } });
    return ok({ record, body });
  });
}

/**
 * A file for a client signed in to the portal. It must belong to the client's
 * own organization and be marked visible to them. A file that fails either
 * test is "not found": the answer never says it exists.
 */
export function openFileForClient(deps: FilesDeps, client: { readonly clientUserId: Id; readonly organizationId: Id } | null, fileId: Id): Result<OpenedFile, "not-found"> {
  if (client === null) return err("not-found");
  return deps.transact(() => {
    const record = deps.files.get(fileId);
    if (!record || record.organizationId !== client.organizationId || !record.clientVisible) return err("not-found");
    const body = deps.blobs.get(fileId);
    if (!body) return err("not-found");
    recordActivity(deps, { actorId: null, action: "file.downloaded", recordType: "file", recordId: fileId, context: { name: record.name, by: "client", clientUserId: client.clientUserId } });
    return ok({ record, body });
  });
}

/**
 * Stores a file a client sent in through the portal, on one of their own
 * projects. The caller has already checked the project is theirs. The file
 * gets the same checks as any upload: its type by its contents, and its
 * size. It belongs to the client's organization, so they can download it
 * again, and nobody at another client can. Call it inside a transaction.
 *
 * A client holds no permission key. What lets them do this is being signed
 * in to the portal as a user of the organization the project belongs to.
 */
export function saveFileFromClient(deps: FilesDeps, client: { readonly clientUserId: Id; readonly organizationId: Id }, projectId: Id, upload: { readonly name: string; readonly bytes: Uint8Array } | null): Result<FileRecord, UploadError | "too-many-files"> {
  const checked = checkUpload(upload);
  if (!checked.ok || !upload) return checked.ok ? err("file-missing") : checked;
  const at = deps.clock();
  const dayAgo = Temporal.Instant.from(at).subtract({ hours: 24 }).toString();
  const recent = deps.files.listForOwner(CLIENT_UPLOAD, projectId).filter((file) => file.createdAt > dayAgo);
  if (recent.length >= MAX_CLIENT_FILES_A_DAY) return err("too-many-files");
  const record: FileRecord = {
    id: deps.newId(),
    name: checked.value.name,
    contentType: checked.value.contentType,
    sizeBytes: upload.bytes.length,
    sha256: deps.digest(upload.bytes),
    ownerType: CLIENT_UPLOAD,
    ownerId: projectId,
    organizationId: client.organizationId,
    clientVisible: true,
    uploadedBy: null,
    uploadedByClient: client.clientUserId,
  };
  deps.files.insert(record, at);
  deps.blobs.put(record.id, upload.bytes);
  recordActivity(deps, { actorId: null, action: "file.received-from-client", recordType: "file", recordId: record.id, context: { name: record.name, sizeBytes: record.sizeBytes, projectId, clientUserId: client.clientUserId } });
  return ok(record);
}
