import {z} from 'zod'

const booleanEnv = z.enum(['true', 'false']).transform((value) => value === 'true')

const rawEnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY_HEADERS: booleanEnv.default('false'),

    JWT_SECRET: z.string().trim().optional(),
    JWT_ISSUER: z.string().trim().min(1).default('study-agent'),
    JWT_AUDIENCE: z.string().trim().min(1).default('study-agent-api'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(15 * 60),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(90 * 86400).default(7 * 86400),
    ADMIN_USER_IDS: z.string().default(''),
    ADMIN_USERNAMES: z.string().default(''),

    AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(5),
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86400).default(15 * 60),
    AUTH_REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(5),
    AUTH_REGISTER_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86400).default(60 * 60),
    AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(5000).default(30),
    AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86400).default(60),
    CHAT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(30),
    CHAT_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86400).default(60),
    CHAT_MAX_CONCURRENT_PER_USER: z.coerce.number().int().min(1).max(100).default(2),
    CHAT_MAX_CONCURRENT_PER_SESSION: z.coerce.number().int().min(1).max(20).default(1),
    RATE_LIMIT_MAX_KEYS: z.coerce.number().int().min(100).max(1_000_000).default(10_000),

    DATABASE_URL: z.string().trim().min(1).optional(),
    DB_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
    DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(0).max(3600).default(20),
    DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(10),
    DB_SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(5),
    HEALTHCHECK_DB_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(1500),

    UPLOAD_DIR: z.string().trim().min(1).default('uploads'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

    LLM_MODEL_FAST: z.string().trim().min(1).default('lmstudio:qwen-local'),
    LLM_MODEL_GENERAL: z.string().trim().min(1).default('lmstudio:qwen-local'),
    LLM_MODEL_REASONING: z.string().trim().min(1).default('openai:gpt-5-mini'),
    LLM_MODEL_VISION: z.string().trim().min(1).default('openai:gpt-5-mini'),
    LLM_MODEL_FALLBACK: z.string().trim().min(1).default('anthropic:claude-sonnet-4-5'),

    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    LM_STUDIO_BASE_URL: z.string().url().default('http://127.0.0.1:1234/v1'),
    LM_STUDIO_API_KEY: z.string().default('lm-studio'),
    VLLM_BASE_URL: z.string().url().default('http://127.0.0.1:8000/v1'),
    VLLM_API_KEY: z.string().default('local-vllm'),
}).superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && (!value.JWT_SECRET || value.JWT_SECRET.length < 32)) {
        context.addIssue({
            code: 'custom',
            path: ['JWT_SECRET'],
            message: 'JWT_SECRET must contain at least 32 characters in production',
        })
    }
})

type RawEnv = z.infer<typeof rawEnvSchema>

function splitCsv(value: string): string[] {
    return [...new Set(
        value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
    )]
}

function parseEnvironment(source: NodeJS.ProcessEnv): RawEnv {
    const result = rawEnvSchema.safeParse(source)
    if (result.success) return result.data

    const details = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
        .join('\n')
    throw new Error(`Invalid environment configuration:\n${details}`)
}

const raw = parseEnvironment(process.env)
const developmentJwtSecret = 'study-agent-development-secret-change-me'

export const env = Object.freeze({
    nodeEnv: raw.NODE_ENV,
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
    server: {
        host: raw.HOST,
        port: raw.PORT,
        corsOrigins: splitCsv(raw.CORS_ORIGINS),
        trustProxyHeaders: raw.TRUST_PROXY_HEADERS,
    },
    auth: {
        jwtSecret: raw.JWT_SECRET || developmentJwtSecret,
        issuer: raw.JWT_ISSUER,
        audience: raw.JWT_AUDIENCE,
        accessTokenTtlSeconds: raw.ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlSeconds: raw.REFRESH_TOKEN_TTL_SECONDS,
        adminUserIds: new Set(splitCsv(raw.ADMIN_USER_IDS)),
        adminUsernames: new Set(splitCsv(raw.ADMIN_USERNAMES)),
    },
    limits: {
        maxKeys: raw.RATE_LIMIT_MAX_KEYS,
        authLogin: {
            limit: raw.AUTH_LOGIN_RATE_LIMIT_MAX,
            windowMs: raw.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000,
        },
        authRegister: {
            limit: raw.AUTH_REGISTER_RATE_LIMIT_MAX,
            windowMs: raw.AUTH_REGISTER_RATE_LIMIT_WINDOW_SECONDS * 1000,
        },
        authRefresh: {
            limit: raw.AUTH_REFRESH_RATE_LIMIT_MAX,
            windowMs: raw.AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS * 1000,
        },
        chat: {
            limit: raw.CHAT_RATE_LIMIT_MAX,
            windowMs: raw.CHAT_RATE_LIMIT_WINDOW_SECONDS * 1000,
            maxConcurrentPerUser: raw.CHAT_MAX_CONCURRENT_PER_USER,
            maxConcurrentPerSession: raw.CHAT_MAX_CONCURRENT_PER_SESSION,
        },
    },
    database: {
        url: raw.DATABASE_URL,
        maxConnections: raw.DB_MAX_CONNECTIONS,
        idleTimeoutSeconds: raw.DB_IDLE_TIMEOUT_SECONDS,
        connectTimeoutSeconds: raw.DB_CONNECT_TIMEOUT_SECONDS,
        shutdownTimeoutSeconds: raw.DB_SHUTDOWN_TIMEOUT_SECONDS,
        healthcheckTimeoutMs: raw.HEALTHCHECK_DB_TIMEOUT_MS,
    },
    uploads: {
        directory: raw.UPLOAD_DIR,
        maxBytes: raw.MAX_UPLOAD_BYTES,
    },
    models: {
        fast: raw.LLM_MODEL_FAST,
        general: raw.LLM_MODEL_GENERAL,
        reasoning: raw.LLM_MODEL_REASONING,
        vision: raw.LLM_MODEL_VISION,
        fallback: raw.LLM_MODEL_FALLBACK,
    },
    providers: {
        openaiApiKey: raw.OPENAI_API_KEY,
        anthropicApiKey: raw.ANTHROPIC_API_KEY,
        lmStudioBaseUrl: raw.LM_STUDIO_BASE_URL,
        lmStudioApiKey: raw.LM_STUDIO_API_KEY,
        vllmBaseUrl: raw.VLLM_BASE_URL,
        vllmApiKey: raw.VLLM_API_KEY,
    },
})

export function requireDatabaseUrl(): string {
    if (!env.database.url) {
        throw new Error('DATABASE_URL is required when starting the API or using database features')
    }
    return env.database.url
}

export type AppEnvironment = typeof env
