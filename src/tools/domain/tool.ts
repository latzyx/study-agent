import type {ZodType} from 'zod'

export interface ToolContext {
    userId?: string
    sessionId?: string
    abortSignal?: AbortSignal
}

export interface Tool<TInput = unknown, TOutput = unknown> {
    name: string
    description: string
    inputSchema: ZodType<TInput>

    execute(
        input: TInput,
        context: ToolContext,
    ): Promise<TOutput>
}
