import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { exec } from 'node:child_process';
import path from 'node:path';
import util from 'node:util';

// Promisify exec for async/await usage
const execPromise = util.promisify(exec);

// Define the schema for the convert_format tool input
const ConvertFormatInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file within the workspace."),
  output_path: z.string().describe("Relative path for the converted output image file within the workspace."),
  target_format: z.string().describe("The desired output format (e.g., png, jpg, webp, gif). The output_path extension should match this."),
});

// --- MCP Server Setup ---
const server = new Server(
  {
    name: "image-converter-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- ListTools Handler ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "convert_format",
        description: "Converts an image file from one format to another using ImageMagick.",
        inputSchema: zodToJsonSchema(ConvertFormatInputSchema),
      },
      // TODO: Add other tools like resize, rotate, etc.
    ],
  };
});

// --- CallTool Handler ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!request.params.arguments) {
    throw new Error("Arguments are required for tool call.");
  }

  switch (request.params.name) {
    case "convert_format": {
      try {
        const args = ConvertFormatInputSchema.parse(request.params.arguments);

        // Define the base directory inside the container where the workspace is mounted
        const baseDir = "/workspace"; 
        const absInputPath = path.resolve(baseDir, args.input_path);
        const absOutputPath = path.resolve(baseDir, args.output_path);

        // Basic security check: ensure paths stay within the workspace
        if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Paths must be within the mounted workspace.");
        }

        // Construct the ImageMagick command
        // Use double quotes for paths to handle potential spaces
        const command = `convert "${absInputPath}" "${absOutputPath}"`;
        console.error(`Executing command: ${command}`); // Log the command being run

        const { stdout, stderr } = await execPromise(command);

        if (stderr) {
          console.error(`ImageMagick stderr: ${stderr}`);
          // Note: ImageMagick sometimes uses stderr for warnings, not just errors.
          // Depending on strictness, you might only throw if the command failed.
        }
        console.error(`ImageMagick stdout: ${stdout}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                output_path: args.output_path, // Return relative path
                message: `Image successfully converted to ${args.output_path}`,
                stderr: stderr || null, // Include stderr if present
              }),
            },
          ],
        };
      } catch (error: any) {
        console.error(`Error during convert_format: ${error.message || error}`);
        // Handle potential errors from execPromise (e.g., command not found, non-zero exit code)
        let errorMessage = `Failed to convert image.`;
        if (error.stderr) {
          errorMessage += ` Stderr: ${error.stderr}`;
        }
        if (error.stdout) {
          errorMessage += ` Stdout: ${error.stdout}`;
        }
        if (error.message) {
             errorMessage += ` Error: ${error.message}`;
        }
        
        throw new Error(errorMessage); // Throw error to be caught by the SDK
      }
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// --- Run Server ---
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Image Converter MCP Server running on stdio");
  } catch (error) {
    console.error("Failed to start Image Converter MCP Server:", error);
    process.exit(1);
  }
}

runServer(); 