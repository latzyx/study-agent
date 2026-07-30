import {resolveClientIp} from '../api/http/client-ip.js'
import {db} from '../db/index.js'
import {auditLogs} from '../db/schema.js'

export interface AuditLogInput {
    userId?: string | null
    action: string
    resourceType?: string
    resourceId?: string
    details?: Record<string, unknown>
    request?: Request
}

export async function recordAuditLog(input: AuditLogInput): Promise<void> {
    try {
        await db.insert(auditLogs).values({
            userId: input.userId ?? null,
            action: input.action.slice(0, 50),
            resourceType: input.resourceType?.slice(0, 50) ?? null,
            resourceId: input.resourceId ?? null,
            details: input.details ?? null,
            ipAddress: input.request ? resolveClientIp(input.request.headers) : null,
        })
    } catch (error) {
        console.error('[audit-log] Failed to persist audit event', {
            action: input.action,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            error,
        })
    }
}
