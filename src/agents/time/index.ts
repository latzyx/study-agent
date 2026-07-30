import type {BuiltinAgentDefinition} from '../domain/agent-definition.js'
import {currentTimeTool} from './tools/current-time.tool.js'

export const timeAgentDefinition: BuiltinAgentDefinition = {
    key: 'time',
    name: 'Time Agent',
    description: 'Handles current time, date and timezone requests.',
    systemPrompt: 'You are a time and timezone assistant. Use the current_time tool for live time queries.',
    tools: [currentTimeTool],
}

export {currentTimeSchema, currentTimeTool} from './tools/current-time.tool.js'
