import type {BuiltinAgentKey} from '../../intent/domain/intent.js'
import type {Tool} from '../../tools/domain/tool.js'

export interface BuiltinAgentDefinition {
    key: BuiltinAgentKey
    name: string
    description: string
    systemPrompt: string
    tools: readonly Tool[]
}
