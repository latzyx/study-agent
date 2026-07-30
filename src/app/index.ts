import {Elysia} from 'elysia'
import {cors} from '@elysiajs/cors'
import {swagger} from '@elysiajs/swagger'
import {
    authRoutes,
    agentRoutes,
    chatRoutes,
    adminRoutes,
    fileRoutes,
    healthRoutes,
} from '../api/routes/index.js'

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? '0.0.0.0'
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

const app = new Elysia()
    .use(cors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : true,
        credentials: false,
        allowedHeaders: ['Content-Type', 'Authorization'],
    }))
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
                    BearerAuth: {type: 'http', scheme: 'bearer', bearerFormat: 'JWT'},
                },
            },
        },
    }))
    .group('/api/v1', (api) => api
        .use(authRoutes)
        .use(agentRoutes)
        .use(chatRoutes)
        .use(adminRoutes)
        .use(fileRoutes)
        .use(healthRoutes))
    .listen({port, hostname})

console.log(
    `Study Agent API: http://${app.server?.hostname}:${app.server?.port}`,
    `\nSwagger: http://${app.server?.hostname}:${app.server?.port}/docs`,
)
