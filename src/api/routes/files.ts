import {Elysia, t} from 'elysia'
import {and, eq} from 'drizzle-orm'
import {unlink} from 'node:fs/promises'
import * as path from 'node:path'
import {db} from '../../db/index.js'
import {files} from '../../db/schema.js'
import {
    authenticateAccessToken,
    authPlugin,
    unauthorizedResponse,
} from '../middleware/auth.js'

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? 'uploads')
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024)

function apiError(status: number, code: string, message: string): Response {
    return Response.json({success: false, error: {code, message}}, {status})
}

function serializeFile(file: typeof files.$inferSelect) {
    return {
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType ?? undefined,
        size: Number(file.size ?? 0),
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
        async ({JWT, headers, body}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const file = body.file
            if (!file) return apiError(400, 'NO_FILE', 'No file provided')
            if (file.size > MAX_UPLOAD_BYTES) {
                return apiError(413, 'FILE_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES} bytes`)
            }

            const extension = path.extname(file.name).toLowerCase().slice(0, 20)
            const storageName = `${crypto.randomUUID()}${extension}`
            const storagePath = path.join(UPLOAD_DIR, storageName)

            await Bun.write(storagePath, file)

            try {
                const [saved] = await db.insert(files).values({
                    userId: user.sub,
                    filename: file.name,
                    storagePath,
                    mimeType: file.type,
                    size: file.size,
                }).returning()

                if (!saved) throw new Error('Failed to save file metadata')
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
        async ({params, JWT, headers}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const file = await findOwnedFile(user.sub, params.id)
            if (!file) return apiError(404, 'NOT_FOUND', 'File not found')

            await db.delete(files).where(and(eq(files.id, file.id), eq(files.userId, user.sub)))
            await unlink(file.storagePath).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') throw error
            })

            return {success: true}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Delete a file', security: [{BearerAuth: []}]},
        },
    )
