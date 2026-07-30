import {Elysia, t} from 'elysia'
import {eq} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {files} from '../../db/schema.js'
import {authPlugin} from '../middleware/auth.js'
import * as fs from 'fs'
import * as path from 'path'

const UPLOAD_DIR = path.resolve('uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, {recursive: true})

async function requireUser(JWT: any, auth: any) {
    if (!auth?.value) throw new Error('Unauthorized')
    const payload = await JWT.verify(auth.value)
    if (!payload) throw new Error('Unauthorized')
    return payload as {sub: string; username: string}
}

export const fileRoutes = new Elysia({prefix: '/files'})
    .use(authPlugin)
    .post(
        '/upload',
        // @ts-ignore
        async ({JWT, cookie: {auth}, body}) => {
            const user = await requireUser(JWT, auth)
            const file = body.file
            if (!file) return new Response(JSON.stringify({success: false, error: {code: 'NO_FILE', message: 'No file provided'}}), {status: 400, headers: {'Content-Type': 'application/json'}})

            const ext = path.extname(file.name)
            const storageName = `${crypto.randomUUID()}${ext}`
            const storagePath = path.join(UPLOAD_DIR, storageName)
            const arrayBuffer = await file.arrayBuffer()
            fs.writeFileSync(storagePath, Buffer.from(arrayBuffer))

            const [saved] = await db.insert(files).values({userId: user.sub, filename: file.name, storagePath, mimeType: file.type, size: file.size}).returning()
            return {success: true, data: {id: saved!.id, filename: saved!.filename, mimeType: saved!.mimeType ?? undefined, size: Number(saved!.size), createdAt: saved!.createdAt.toISOString()}}
        },
        {body: t.Object({file: t.File()}), detail: {summary: 'Upload a file', security: [{BearerAuth: []}]}},
    )
    .get(
        '/:id',
        async ({params}) => {
            const [file] = await db.select().from(files).where(eq(files.id, params.id)).limit(1)
            if (!file) return new Response(JSON.stringify({success: false, error: {code: 'NOT_FOUND', message: 'File not found'}}), {status: 404, headers: {'Content-Type': 'application/json'}})
            return {success: true, data: {id: file.id, filename: file.filename, mimeType: file.mimeType ?? undefined, size: Number(file.size), createdAt: file.createdAt.toISOString()}}
        },
        {params: t.Object({id: t.String()}), detail: {summary: 'Get file info'}},
    )
    .delete(
        '/:id',
        // @ts-ignore
        async ({params, JWT, cookie: {auth}}) => {
            const user = await requireUser(JWT, auth)
            const [file] = await db.select().from(files).where(eq(files.id, params.id)).limit(1)
            if (!file) return new Response(JSON.stringify({success: false, error: {code: 'NOT_FOUND', message: 'File not found'}}), {status: 404, headers: {'Content-Type': 'application/json'}})
            if (file.userId !== user.sub) return new Response(JSON.stringify({success: false, error: {code: 'FORBIDDEN', message: 'Not the owner'}}), {status: 403, headers: {'Content-Type': 'application/json'}})
            if (fs.existsSync(file.storagePath)) fs.unlinkSync(file.storagePath)
            await db.delete(files).where(eq(files.id, params.id))
            return {success: true}
        },
        {params: t.Object({id: t.String()}), detail: {summary: 'Delete a file', security: [{BearerAuth: []}]}},
    )
