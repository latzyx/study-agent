import {Elysia, t} from 'elysia'
import {
    deleteUserFile,
    findUserFile,
    saveUserFile,
    serializeFile,
} from '../../services/file-service.js'
import {recordAuditLog} from '../../services/audit-log-service.js'
import {authPlugin, requireAccessToken} from '../middleware/auth.js'

export const fileRoutes = new Elysia({prefix: '/files'})
    .use(authPlugin)
    .post(
        '/upload',
        async ({JWT, headers, body, request}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            const saved = await saveUserFile(user.sub, body.file)
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
        },
        {
            body: t.Object({file: t.File()}),
            detail: {summary: 'Upload a file', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/:id',
        async ({params, JWT, headers}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            const file = await findUserFile(user.sub, params.id)
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
            const user = await requireAccessToken(JWT, headers.authorization)
            const deleted = await deleteUserFile(user.sub, params.id)
            await recordAuditLog({
                userId: user.sub,
                action: 'file.delete',
                resourceType: 'file',
                resourceId: deleted.id,
                details: {filename: deleted.filename, size: deleted.size},
                request,
            })

            return {success: true}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Delete a file', security: [{BearerAuth: []}]},
        },
    )
