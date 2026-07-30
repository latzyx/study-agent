import {and, eq} from 'drizzle-orm'
import {mkdir, rename, unlink} from 'node:fs/promises'
import * as path from 'node:path'
import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'
import {db} from '../db/index.js'
import {files} from '../db/schema.js'

const uploadDirectory = path.resolve(env.uploads.directory)
const uploadDirectoryReady = mkdir(uploadDirectory, {recursive: true})

export function serializeFile(file: typeof files.$inferSelect) {
    return {
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType ?? undefined,
        size: file.size,
        createdAt: file.createdAt.toISOString(),
    }
}

function validateUpload(file: File): void {
    if (!file.name || file.name.length > 255 || path.basename(file.name) !== file.name) {
        throw createApiError(
            400,
            'INVALID_FILENAME',
            'Filename must be a plain name containing 1 to 255 characters',
        )
    }

    if (file.size > env.uploads.maxBytes) {
        throw createApiError(
            413,
            'FILE_TOO_LARGE',
            `File exceeds ${env.uploads.maxBytes} bytes`,
            {maxBytes: env.uploads.maxBytes},
        )
    }
}

function resolveManagedStoragePath(storagePath: string): string {
    const resolved = path.resolve(storagePath)
    const managedPrefix = `${uploadDirectory}${path.sep}`

    if (!resolved.startsWith(managedPrefix)) {
        throw createApiError(
            500,
            'INVALID_STORAGE_PATH',
            'Stored file path is outside the configured upload directory',
        )
    }

    return resolved
}

export async function saveUserFile(userId: string, file: File) {
    validateUpload(file)
    await uploadDirectoryReady

    const extension = path.extname(file.name).toLowerCase().slice(0, 20)
    const storagePath = path.join(uploadDirectory, `${crypto.randomUUID()}${extension}`)
    const bytesWritten = await Bun.write(storagePath, file)

    if (bytesWritten !== file.size) {
        await unlink(storagePath).catch(() => undefined)
        throw createApiError(500, 'FILE_WRITE_INCOMPLETE', 'Failed to write the complete file')
    }

    try {
        const [saved] = await db.insert(files).values({
            userId,
            filename: file.name,
            storagePath,
            mimeType: file.type || null,
            size: file.size,
        }).returning()

        if (!saved) {
            throw createApiError(500, 'FILE_METADATA_CREATE_FAILED', 'Failed to save file metadata')
        }

        return saved
    } catch (error) {
        await unlink(storagePath).catch(() => undefined)
        throw error
    }
}

export async function findUserFile(userId: string, fileId: string) {
    const [file] = await db.select().from(files).where(and(
        eq(files.id, fileId),
        eq(files.userId, userId),
    )).limit(1)

    if (!file) throw createApiError(404, 'FILE_NOT_FOUND', 'File not found')
    return file
}

export async function deleteUserFile(userId: string, fileId: string) {
    const file = await findUserFile(userId, fileId)
    const originalPath = resolveManagedStoragePath(file.storagePath)
    const tombstonePath = `${originalPath}.deleting-${crypto.randomUUID()}`
    let movedToTombstone = false

    try {
        try {
            await rename(originalPath, tombstonePath)
            movedToTombstone = true
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException
            if (nodeError.code !== 'ENOENT') throw error
        }

        const [deleted] = await db.delete(files)
            .where(and(eq(files.id, fileId), eq(files.userId, userId)))
            .returning({id: files.id})

        if (!deleted) {
            throw createApiError(404, 'FILE_NOT_FOUND', 'File not found')
        }

        if (movedToTombstone) {
            await unlink(tombstonePath).catch((error) => {
                console.error('[files] Failed to remove tombstone file', {
                    fileId,
                    tombstonePath,
                    error,
                })
            })
        }

        return file
    } catch (error) {
        if (movedToTombstone) {
            await rename(tombstonePath, originalPath).catch((restoreError) => {
                console.error('[files] Failed to restore file after metadata deletion failure', {
                    fileId,
                    originalPath,
                    tombstonePath,
                    restoreError,
                })
            })
        }
        throw error
    }
}
