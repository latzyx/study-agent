import type {BuiltinAgentDefinition} from '../domain/agent-definition.js'
import {calculatorTool} from './tools/calculator.tool.js'

export const mathAgentDefinition: BuiltinAgentDefinition = {
    key: 'math',
    name: 'Math Agent',
    description: 'Handles arithmetic and deterministic calculation requests.',
    systemPrompt: 'You are a precise calculation assistant. Use the calculator tool for arithmetic.',
    tools: [calculatorTool],
}

export {calculatorSchema, calculatorTool} from './tools/calculator.tool.js'
