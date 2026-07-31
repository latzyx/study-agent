import {z} from 'zod'
import type {Tool} from '../../../tools/domain/tool.js'

function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', {timeZone}).format()
        return true
    } catch {
        return false
    }
}

export const currentTimeSchema = z.object({
    timezone: z.string()
        .trim()
        .min(1)
        .refine(isValidTimeZone, '必须是有效的 IANA 时区，例如 Asia/Shanghai')
        .optional()
        .describe('IANA 时区，例如 Asia/Shanghai'),
})

export type CurrentTimeInput = z.infer<typeof currentTimeSchema>

export interface CurrentTimeOutput {
    timestamp: string
    formatted: string
    timezone: string
}

export const currentTimeTool: Tool<CurrentTimeInput, CurrentTimeOutput> = {
    name: 'current_time',
    description: '获取指定 IANA 时区的当前时间；未指定时使用 UTC。',
    inputSchema: currentTimeSchema,

    async execute({timezone}) {
        const now = new Date()
        const resolvedTimeZone = timezone ?? 'UTC'
        const formatted = new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: resolvedTimeZone,
            timeZoneName: 'short',
        }).format(now)

        return {
            timestamp: now.toISOString(),
            formatted,
            timezone: resolvedTimeZone,
        }
    },
}
