import {cors} from '@elysiajs/cors'
import {swagger} from '@elysiajs/swagger'
import {Elysia} from 'elysia'
import {env} from '../config/env.js'
import {errorHandlerPlugin} from '../api/middleware/error-handler.js'
import {operationLogPlugin} from '../api/middleware/operation-log.js'
import {
    adminRoutes,
    agentRoutes,
    authRoutes,
    chatRoutes,
    fileRoutes,
    healthRoutes,
} from '../api/routes/index.js'

export function createApp() {
    return new Elysia({name: 'study-agent-api'})
        .use(cors({
            origin: env.server.corsOrigins.length > 0
                ? env.server.corsOrigins
                : true,
            credentials: false,
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
            exposeHeaders: ['X-Request-Id'],
        }))
        .use(errorHandlerPlugin)
        .use(swagger({
            path: '/docs',
            documentation: {
                info: {
                    title: 'Study Agent API',
                    version: '1.0.0',
                    description: 'Multi-agent AI system API',
                },
                components: {
                    securitySchemes: {
                        BearerAuth: {
                            type: 'http',
                            scheme: 'bearer',
                            bearerFormat: 'JWT',
                        },
                    },
                },
            },
        }))
        .group('/api/v1', (api) => api
            .use(operationLogPlugin)
            .use(authRoutes)
            .use(agentRoutes)
            .use(chatRoutes)
            .use(adminRoutes)
            .use(fileRoutes)
            .use(healthRoutes))
}

export type StudyAgentApp = ReturnType<typeof createApp>
