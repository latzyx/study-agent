import { z } from "zod";
import type { ToolWithAI } from "../domain/tool";

export const calculatorSchema = z.object({
    a: z.number().describe("第一个数字"),
    b: z.number().describe("第二个数字"),
    op: z.enum(["add", "subtract", "multiply", "divide"]),
});

export type CalculatorInput = z.infer<typeof calculatorSchema>;

export const calculatorTool: ToolWithAI<CalculatorInput> = {
    name: "calculator",
    description: "执行两个数字的基础运算。必须使用参数: a(第一个数字), b(第二个数字), op(运算符: add/subtract/multiply/divide)",
    inputSchema: calculatorSchema,
    
    execute: async ({ a, b, op }, options) => {
        switch (op) {
            case "add":
                return { expression: `${a} + ${b}`, result: a + b };
            case "subtract":
                return { expression: `${a} - ${b}`, result: a - b };
            case "multiply":
                return { expression: `${a} × ${b}`, result: a * b };
            case "divide":
                if (b === 0) {
                    throw new Error("除数不能为 0");
                }
                return { expression: `${a} ÷ ${b}`, result: a / b };
        }
    },
};
