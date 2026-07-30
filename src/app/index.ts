import {Elysia} from 'elysia'
import {jwt} from '@elysiajs/jwt'
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

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

const app = new Elysia()
    .use(cors({origin: true, credentials: true}))
    .use(jwt({name: 'JWT', secret: JWT_SECRET}))
    .use(swagger({
        path: '/docs',
        documentation: {
            info: {title: 'Study Agent API', version: '1.0.0', description: 'Multi-agent AI system API'},
            components: {securitySchemes: {BearerAuth: {type: 'http', scheme: 'bearer', bearerFormat: 'JWT'}}},
        },
    }))
    .group('/api/v1', (app) =>
        app
            .use(authRoutes)
            .use(agentRoutes)
            .use(chatRoutes)
            .use(adminRoutes)
            .use(fileRoutes)
            .use(healthRoutes),
    )
    .listen(3000)

console.log(
    `🦊 Elysia 正在运行在 ${app.server?.hostname}:${app.server?.port}`,
    `\n📖 Swagger 文档: http://${app.server?.hostname}:${app.server?.port}/docs`,
)
