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

const ResizeImageInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
  output_path: z.string().describe("Relative path for the resized output image file."),
  width: z.number().int().positive().optional().describe("Target width in pixels (optional)."),
  height: z.number().int().positive().optional().describe("Target height in pixels (optional)."),
  percentage: z.number().int().positive().max(1000).optional().describe("Percentage to resize by (optional, overrides width/height if provided)."),
  // ImageMagick geometry flags can be added here if needed, e.g., '!' to force exact size
}).refine(data => data.width || data.height || data.percentage, {
  message: "Either width/height or percentage must be provided for resizing.",
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
      {
        name: "resize_image",
        description: "Resizes an image to specified dimensions or percentage using ImageMagick.",
        inputSchema: zodToJsonSchema(ResizeImageInputSchema),
      },
      // TODO: Add other tools like rotate, etc.
    ],
  };
});

// --- CallTool Handler ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!request.params.arguments) {
    throw new Error("Arguments are required for tool call.");
  }

  // Define the base directory inside the container where the workspace is mounted
  const baseDir = "/workspace";

  switch (request.params.name) {
    case "convert_format": {
      try {
        const args = ConvertFormatInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        const absOutputPath = path.resolve(baseDir, args.output_path);
        if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Paths must be within the mounted workspace.");
        }
        const command = `convert "${absInputPath}" "${absOutputPath}"`;
        console.error(`Executing command: ${command}`);
        const { stdout, stderr } = await execPromise(command);
        if (stderr) console.error(`ImageMagick stderr: ${stderr}`);
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

    case "resize_image": {
      try {
        const args = ResizeImageInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        const absOutputPath = path.resolve(baseDir, args.output_path);

        if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Paths must be within the mounted workspace.");
        }

        let resizeArg = "";
        if (args.percentage) {
          resizeArg = `${args.percentage}%`;
        } else {
          // ImageMagick handles missing width/height by preserving aspect ratio
          resizeArg = `${args.width || ''}x${args.height || ''}`;
        }

        const command = `convert "${absInputPath}" -resize ${resizeArg} "${absOutputPath}"`;
        console.error(`Executing command: ${command}`);

        const { stdout, stderr } = await execPromise(command);
        if (stderr) console.error(`ImageMagick stderr: ${stderr}`);
        console.error(`ImageMagick stdout: ${stdout}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                output_path: args.output_path,
                message: `Image successfully resized to ${args.output_path}`,
                stderr: stderr || null,
              }),
            },
          ],
        };
      } catch (error: any) {
        console.error(`Error during resize_image: ${error.message || error}`);
        let errorMessage = `Failed to resize image.`;
        if (error.stderr) errorMessage += ` Stderr: ${error.stderr}`;
        if (error.stdout) errorMessage += ` Stdout: ${error.stdout}`;
        if (error.message) errorMessage += ` Error: ${error.message}`;
        throw new Error(errorMessage);
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