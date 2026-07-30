import { z } from "zod";
import type { ToolWithAI } from "../domain/tool";

export const currentTimeSchema = z.object({
    timezone: z.string().optional().describe("时区，如 Asia/Shanghai"),
});

export type CurrentTimeInput = z.infer<typeof currentTimeSchema>;

export const currentTimeTool: ToolWithAI<CurrentTimeInput> = {
    name: "current_time",
    description: "获取当前时间",
    inputSchema: currentTimeSchema,
    
    execute: async ({ timezone }, options) => {
        const now = new Date();
        const formatOptions: Intl.DateTimeFormatOptions = {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        };
        
        if (timezone) {
            formatOptions.timeZone = timezone;
        }
        
        const formatted = new Intl.DateTimeFormat("zh-CN", formatOptions).format(now);
        return {
            timestamp: now.toISOString(),
            formatted,
            timezone: timezone || "UTC",
        };
    },
};
