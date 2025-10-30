#!/usr/bin/env node
import express from "express";
import cors from "cors";
import axios from "axios";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
const RADIOFM_API = "https://devappradiofm.radiofm.co/rfm/api";
const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(express.json());
// Create MCP server instance
const server = new Server({ name: "radiofm-mcp-server", version: "1.3.0" }, { capabilities: { tools: {} } });
// ===================== TOOL DEFINITIONS ===================== //
const listTools = async () => ({
    tools: [
        {
            name: "search_radio_stations",
            description: "Search for radio stations and podcasts on RadioFM by name, language, country, or genre.",
            inputSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search term (e.g., 'BBC', 'India', 'Hindi', 'Jazz', 'News')",
                    },
                },
                required: ["query"],
            },
        },
    ],
});
const callTool = async (query) => {
    if (!query)
        throw new Error("Missing query term.");
    const { data } = await axios.get(`${RADIOFM_API}/new_combo_search.php?srch=${encodeURIComponent(query)}`);
    const results = data.data?.Data ?? [];
    if (!results.length) {
        return {
            content: [
                {
                    type: "text",
                    text: `🔍 No results found for "${query}". Try different station names, countries, or genres.`,
                },
            ],
        };
    }
    const formatted = results
        .map((group) => {
        const type = group.type.toUpperCase();
        const list = (group.data || [])
            .map((item, i) => {
            const name = item.st_name || item.p_name;
            const genre = item.st_genre || item.cat_name;
            const link = item.deeplink || `https://appradiofm.com/radioplay/${item.st_shorturl}`;
            return `${i + 1}. ${name} (${genre})\n▶ ${link}`;
        })
            .join("\n");
        return `\n🎧 ${type}\n${list}`;
    })
        .join("\n");
    return { content: [{ type: "text", text: `🔍 Results for "${query}":\n${formatted}` }] };
};
// Register MCP request handlers
server.setRequestHandler(ListToolsRequestSchema, listTools);
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const query = req.params.arguments?.query;
    return await callTool(query);
});
// ===================== EXPRESS ROUTES ===================== //
// Health check
app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "RadioFM MCP server running", endpoint: "/mcp" });
});
// Main MCP handler
app.post("/mcp", async (req, res) => {
    const { method, id, params } = req.body;
    console.log("⚙️ POST /mcp body:", req.body);
    res.setHeader("Content-Type", "application/json");
    try {
        if (method === "initialize") {
            return res.json({
                jsonrpc: "2.0",
                id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: { tools: {} },
                    serverInfo: { name: "radiofm-mcp-server", version: "1.3.0" },
                },
            });
        }
        if (method === "tools/list") {
            const tools = await listTools();
            return res.json({ jsonrpc: "2.0", id, result: { tools: tools.tools } });
        }
        if (method === "tools/call") {
            const query = params?.arguments?.query;
            const result = await callTool(query);
            return res.json({ jsonrpc: "2.0", id, result });
        }
        return res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Unknown method: ${method}` },
        });
    }
    catch (err) {
        console.error("❌ MCP Error:", err);
        res.status(500).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: err.message || "Internal error" },
        });
    }
});
// SSE endpoint (ChatGPT live link)
app.get("/mcp", async (req, res) => {
    console.log("🔌 ChatGPT attempted SSE connection to /mcp");
    const ua = req.get("user-agent")?.toLowerCase() || "";
    const isSafari = ua.includes("safari") && !ua.includes("chrome") && !ua.includes("android");
    const isMobile = /iphone|ipad|ipod|android/.test(ua);
    if (isSafari || isMobile) {
        console.warn("📱 Fallback mode — SSE not supported.");
        return res.json({
            jsonrpc: "2.0",
            result: {
                message: "SSE not supported on this device. Use POST /mcp for tool calls.",
            },
        });
    }
    try {
        const endpoint = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
        const transport = new SSEServerTransport(endpoint, res);
        await server.connect(transport);
    }
    catch (e) {
        console.error("❌ SSE Error:", e);
        res.status(500).json({ error: e.message });
    }
});
// .well-known endpoints for ChatGPT
app.get("/.well-known/openid-configuration", (req, res) => {
    const base = `${req.protocol}://${req.get("host")}`;
    res.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        mcp_endpoint: `${base}/mcp`,
    });
});
app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = `${req.protocol}://${req.get("host")}`;
    res.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        mcp_endpoint: `${base}/mcp`,
    });
});
app.get("/.well-known/openid-configuration/mcp", (req, res) => {
    const base = `${req.protocol}://${req.get("host")}`;
    res.json({
        mcp_endpoint: `${base}/mcp`,
        capabilities: { tools: true },
    });
});
// ===================== START SERVER ===================== //
app.listen(PORT, () => {
    console.log(`🎧 RadioFM MCP server running at http://localhost:${PORT}/mcp`);
});
