/**
 * MCP server stub (M0). M4+ will expose inspect/design/view/asset/layer/compose tools.
 */
export function startMcpServer(): void {
  console.log("@ai2live/mcp-server stub — not listening yet");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer();
}
