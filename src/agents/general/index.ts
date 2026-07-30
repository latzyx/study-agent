import type {BuiltinAgentDefinition} from '../domain/agent-definition.js'

export const generalAgentDefinition: BuiltinAgentDefinition = {
    key: 'general',
    name: 'General Agent',
    description: 'Fallback assistant for requests without a specialized intent match.',
    systemPrompt: 'You are a helpful general assistant. Do not claim access to tools that are not enabled.',
    tools: [],
}
