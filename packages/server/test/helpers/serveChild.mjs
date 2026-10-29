// Starts the real CLI `serve` command from the compiled test build (what bin/c3d-mcp.js does with the dist build).
import { pathToFileURL } from 'node:url';

const { main } = await import(pathToFileURL(process.argv[2]).href);
process.exitCode = await main(['serve']);
