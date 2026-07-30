import {Elysia, t} from 'elysia'
import {and, eq} from 'drizzle-orm'
import {mkdir, unlink} from 'node:fs/promises'
import * as path from 'node:path'
import {env} from '../../config/env.js'
import {db} from '../../db/index.js'
import {files} from '../../db/schema.js'
import {recordAuditLog} from '../../services/audit-log-service.js'
import {
    authenticateAccessToken,
    authPlugin,
    unauthorizedResponse,
} from '../middleware/auth.js'

const UPLOAD_DIR = path.resolve(env.uploads.directory)
const MAX_UPLOAD_BYTES = env.uploads.maxBytes
const uploadDirectoryReady = mkdir(UPLOAD_DIR, {recursive: true})

function apiError(status: number, code: string, message: string): Response {
    return Response.json({success: false, error: {code, message}}, {status})
}

function serializeFile(file: typeof files.$inferSelect) {
    return {
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType ?? undefined,
        size: file.size,
        createdAt: file.createdAt.toISOString(),
    }
}

async function findOwnedFile(userId: string, fileId: string) {
    const [file] = await db.select().from(files).where(and(
        eq(files.id, fileId),
        eq(files.userId, userId),
    )).limit(1)

    return file
}

export const fileRoutes = new Elysia({prefix: '/files'})
    .use(authPlugin)
    .post(
        '/upload',
        async ({JWT, headers, body, request}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const file = body.file
            if (!file) return apiError(400, 'NO_FILE', 'No file provided')
            if (file.name.length === 0 || file.name.length > 255) {
                return apiError(400, 'INVALID_FILENAME', 'Filename must contain 1 to 255 characters')
            }
            if (file.size > MAX_UPLOAD_BYTES) {
                return apiError(413, 'FILE_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES} bytes`)
            }

            const extension = path.extname(file.name).toLowerCase().slice(0, 20)
            const storageName = `${crypto.randomUUID()}${extension}`
            const storagePath = path.join(UPLOAD_DIR, storageName)

            await uploadDirectoryReady
            await Bun.write(storagePath, file)

            try {
                const [saved] = await db.insert(files).values({
                    userId: user.sub,
                    filename: file.name,
                    storagePath,
                    mimeType: file.type || null,
                    size: file.size,
                }).returning()

                if (!saved) throw new Error('Failed to save file metadata')

                await recordAuditLog({
                    userId: user.sub,
                    action: 'file.upload',
                    resourceType: 'file',
                    resourceId: saved.id,
                    details: {
                        filename: saved.filename,
                        mimeType: saved.mimeType,
                        size: saved.size,
                    },
                    request,
                })

                return {success: true, data: serializeFile(saved)}
            } catch (error) {
                await unlink(storagePath).catch(() => undefined)
                throw error
            }
        },
        {
            body: t.Object({file: t.File()}),
            detail: {summary: 'Upload a file', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/:id',
        async ({params, JWT, headers}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const file = await findOwnedFile(user.sub, params.id)
            if (!file) return apiError(404, 'NOT_FOUND', 'File not found')
            return {success: true, data: serializeFile(file)}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Get file info', security: [{BearerAuth: []}]},
        },
    )
    .delete(
        '/:id',
        async ({params, JWT, headers, request}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const file = await findOwnedFile(user.sub, params.id)
            if (!file) return apiError(404, 'NOT_FOUND', 'File not found')

            const [deleted] = await db.delete(files)
                .where(and(eq(files.id, file.id), eq(files.userId, user.sub)))
                .returning({id: files.id})
            if (!deleted) return apiError(404, 'NOT_FOUND', 'File not found')

            await unlink(file.storagePath).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') {
                    console.error('[files] Failed to remove stored file', {
                        fileId: file.id,
                        storagePath: file.storagePath,
                        error,
                    })
                }
            })

            await recordAuditLog({
                userId: user.sub,
                action: 'file.delete',
                resourceType: 'file',
                resourceId: file.id,
                details: {filename: file.filename, size: file.size},
                request,
            })

            return {success: true}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Delete a file', security: [{BearerAuth: []}]},
        },
    )
