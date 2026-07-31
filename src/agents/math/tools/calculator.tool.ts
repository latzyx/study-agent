import {z} from 'zod'
import type {Tool} from '../../../tools/domain/tool.js'

export const calculatorSchema = z.object({
    a: z.number().finite().describe('第一个数字'),
    b: z.number().finite().describe('第二个数字'),
    op: z.enum(['add', 'subtract', 'multiply', 'divide']),
})

export type CalculatorInput = z.infer<typeof calculatorSchema>

export interface CalculatorOutput {
    expression: string
    result: number
}

export const calculatorTool: Tool<CalculatorInput, CalculatorOutput> = {
    name: 'calculator',
    description: '执行两个有限数字的加、减、乘、除运算。',
    inputSchema: calculatorSchema,

    async execute({a, b, op}) {
        switch (op) {
            case 'add':
                return {expression: `${a} + ${b}`, result: a + b}
            case 'subtract':
                return {expression: `${a} - ${b}`, result: a - b}
            case 'multiply':
                return {expression: `${a} × ${b}`, result: a * b}
            case 'divide':
                if (b === 0) throw new Error('除数不能为 0')
                return {expression: `${a} ÷ ${b}`, result: a / b}
        }
    },
}
