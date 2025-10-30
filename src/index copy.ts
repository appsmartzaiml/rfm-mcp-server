#!/usr/bin/env node
import express from "express";
import type { Request, Response } from "express";
import axios from "axios";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ServerResponse } from "http";

const RADIOFM_API = "https://devappradiofm.radiofm.co/rfm/api";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Create MCP server
const server = new Server(
    { name: "radiofm-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

// --- Register tool list ---
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "search_radio_stations",
            description: "Search RadioFM stations and podcasts.",
            inputSchema: {
                type: "object",
                properties: { query: { type: "string", description: "Search term" } },
                required: ["query"],
            },
        },
    ],
}));

// --- Register tool logic ---
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const query = req.params.arguments?.query as string;
    if (!query) throw new Error("Missing query term");

    const { data } = await axios.get(
        `${RADIOFM_API}/new_combo_search.php?srch=${encodeURIComponent(query)}`
    );

    const results = data.data?.Data ?? [];
    if (!results.length) {
        return { content: [{ type: "text", text: `No results for "${query}".` }] };
    }

    const formatted = results
        .map((group: any) => {
            const type = group.type.toUpperCase();
            const list = (group.data || [])
                .map((item: any, i: number) => {
                    const name = item.st_name || item.p_name;
                    const genre = item.st_genre || item.cat_name;
                    const link =
                        item.deeplink || `https://appradiofm.com/radioplay/${item.st_shorturl}`;
                    return `${i + 1}. ${name} (${genre})\n▶ ${link}`;
                })
                .join("\n");
            return `\n🎧 ${type}\n${list}`;
        })
        .join("\n");

    return {
        content: [{ type: "text", text: `🔍 Results for "${query}":\n${formatted}` }],
    };
});

// --- SSE endpoint for ChatGPT live connection ---
app.get("/mcp", async (req: Request, res: Response) => {
    console.log("🔌 ChatGPT connected to /mcp");
    const endpoint = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const transport = new SSEServerTransport(
        endpoint,
        res as unknown as ServerResponse
    );
    await server.connect(transport);
});

// --- JSON-RPC endpoint for ChatGPT initialization ---
app.post("/mcp", async (req: Request, res: Response) => {
    console.log("⚙️ POST /mcp body:", req.body);

    res.setHeader("Content-Type", "application/json");

    const { method, id, params } = req.body;
    const clientProtocol = params?.protocolVersion || "1.0.0";

    if (method === "initialize") {
        return res.json({
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: {
                    tools: {
                        list: true,  // ✅ explicitly declare tool capability
                    },
                },
                serverInfo: {
                    name: "radiofm-mcp-server",
                    version: "1.0.0",
                    description: "Search live radio, podcasts, and music from RadioFM",
                },
                tools: [
                    {
                        name: "search_radio_stations",
                        description: "Search RadioFM stations and podcasts.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "Search term for a station or podcast",
                                },
                            },
                            required: ["query"],
                        },
                    },
                ],
            },
        });
    }

    // fallback for other methods
    return res.json({
        jsonrpc: "2.0",
        id,
        result: { ok: true },
    });
});




// --- Health check ---
app.get("/", (_req, res) => {
    res.send("✅ RadioFM MCP server is running. Use /mcp endpoint.");
});

app.listen(PORT, () => {
    console.log(`🎧 Server listening on http://localhost:${PORT}/mcp`);
});
