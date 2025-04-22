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

const RotateImageInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
  output_path: z.string().describe("Relative path for the rotated output image file."),
  angle: z.number().describe("Angle in degrees to rotate the image clockwise (e.g., 90, -90, 180)."),
});

const CropImageInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
  output_path: z.string().describe("Relative path for the cropped output image file."),
  width: z.number().int().positive().describe("Width of the crop area in pixels."),
  height: z.number().int().positive().describe("Height of the crop area in pixels."),
  x: z.number().int().nonnegative().describe("X-coordinate of the top-left corner of the crop area."),
  y: z.number().int().nonnegative().describe("Y-coordinate of the top-left corner of the crop area."),
});

const FlipFlopImageInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
  output_path: z.string().describe("Relative path for the flipped/flopped output image file."),
  direction: z.enum(["vertical", "horizontal"]).describe("Direction to mirror the image ('vertical' for flip, 'horizontal' for flop)."),
});

const ApplyFilterInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
  output_path: z.string().describe("Relative path for the filtered output image file."),
  filter_type: z.enum(["grayscale", "sepia", "blur", "sharpen"]).describe("Type of filter to apply."),
  // Optional parameters for specific filters
  blur_radius: z.number().nonnegative().optional().describe("Radius for the blur filter (optional, default 0)."),
  blur_sigma: z.number().positive().optional().describe("Sigma (standard deviation) for the blur filter (optional, required if radius > 0)."),
  sepia_percentage: z.number().int().min(0).max(100).optional().default(80).describe("Percentage for the sepia tone filter (optional, default 80)."),
  sharpen_radius: z.number().nonnegative().optional().describe("Radius for the sharpen filter (optional, default 0)."),
  sharpen_sigma: z.number().positive().optional().describe("Sigma (standard deviation) for the sharpen filter (optional, required if radius > 0)."),
}).refine(data => !(data.filter_type === 'blur' && data.blur_radius && data.blur_radius > 0 && !data.blur_sigma), {
  message: "blur_sigma is required when blur_radius > 0 for the blur filter.",
  path: ["blur_sigma"], // Path to the invalid field
}).refine(data => !(data.filter_type === 'sharpen' && data.sharpen_radius && data.sharpen_radius > 0 && !data.sharpen_sigma), {
  message: "sharpen_sigma is required when sharpen_radius > 0 for the sharpen filter.",
  path: ["sharpen_sigma"], // Path to the invalid field
});

const GetImageInfoInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
});

const CompressImageInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
  output_path: z.string().describe("Relative path for the compressed output image file."),
  quality: z.number().int().min(0).max(100).describe("Compression quality (0-100). Lower values mean higher compression but lower quality. Best for JPG/WebP."),
});

const GetPixelColorInputSchema = z.object({
  input_path: z.string().describe("Relative path to the input image file."),
  x: z.number().int().nonnegative().describe("X-coordinate of the pixel."),
  y: z.number().int().nonnegative().describe("Y-coordinate of the pixel."),
});

const CreateCollageInputSchema = z.object({
  input_paths: z.array(z.string()).min(1).describe("Array of relative paths to the input image files."),
  output_path: z.string().describe("Relative path for the output collage image file."),
  tile_geometry: z.string().regex(/^\d+x\d+$/).describe("Layout grid (e.g., '2x2', '3x1'). Number of images must match cells or be fewer."),
  background_color: z.string().optional().default("white").describe("Background color for empty space (e.g., 'white', '#RRGGBB', 'none')."),
  border: z.number().int().nonnegative().optional().default(0).describe("Border width in pixels around each image."),
  // We could add border_color if needed
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
      {
        name: "rotate_image",
        description: "Rotates an image by a specified number of degrees clockwise.",
        inputSchema: zodToJsonSchema(RotateImageInputSchema),
      },
      {
        name: "crop_image",
        description: "Crops an image to a specified rectangle.",
        inputSchema: zodToJsonSchema(CropImageInputSchema),
      },
      {
        name: "flip_flop_image",
        description: "Mirrors an image vertically (flip) or horizontally (flop).",
        inputSchema: zodToJsonSchema(FlipFlopImageInputSchema),
      },
      {
        name: "apply_filter",
        description: "Applies a common filter (grayscale, sepia, blur, sharpen) to an image.",
        inputSchema: zodToJsonSchema(ApplyFilterInputSchema),
      },
      {
        name: "get_image_info",
        description: "Retrieves metadata information about an image (format, dimensions, depth, colorspace, etc.).",
        inputSchema: zodToJsonSchema(GetImageInfoInputSchema),
      },
      {
        name: "compress_image",
        description: "Reduces image file size by adjusting quality and stripping metadata.",
        inputSchema: zodToJsonSchema(CompressImageInputSchema),
      },
      {
        name: "get_pixel_color",
        description: "Gets the color of a specific pixel at given X, Y coordinates.",
        inputSchema: zodToJsonSchema(GetPixelColorInputSchema),
      },
      {
        name: "create_collage",
        description: "Creates a collage by tiling multiple input images onto a single output image.",
        inputSchema: zodToJsonSchema(CreateCollageInputSchema),
      },
      // TODO: Add other tools like crop, flip/flop, filters, info
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

  // Helper function for running commands and returning success/error
  async function runImageMagickCommand(command: string, successMessage: string, outputPath: string): Promise<any> {
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
              output_path: outputPath,
              message: successMessage,
              stderr: stderr || null,
            }),
          },
        ],
      };
  }

  // Helper function to format error messages
  function formatErrorMessage(toolName: string, error: any): string {
    console.error(`Error during ${toolName}: ${error.message || error}`);
    let errorMessage = `Failed to ${toolName.replace('_', ' ')}.`;
    if (error.stderr) errorMessage += ` Stderr: ${error.stderr}`;
    if (error.stdout) errorMessage += ` Stdout: ${error.stdout}`;
    if (error.message) errorMessage += ` Error: ${error.message}`;
    return errorMessage;
  }

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
        return await runImageMagickCommand(
          command,
          `Image successfully converted to ${args.output_path}`,
          args.output_path
        );
      } catch (error: any) {
        throw new Error(formatErrorMessage("convert_format", error));
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
        return await runImageMagickCommand(
            command,
            `Image successfully resized to ${args.output_path}`,
            args.output_path
        );
      } catch (error: any) {
        throw new Error(formatErrorMessage("resize_image", error));
      }
    }

    case "rotate_image": {
       try {
        const args = RotateImageInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        const absOutputPath = path.resolve(baseDir, args.output_path);
        if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Paths must be within the mounted workspace.");
        }
        
        // ImageMagick's rotate is clockwise
        const command = `convert "${absInputPath}" -rotate ${args.angle} "${absOutputPath}"`;
        return await runImageMagickCommand(
            command,
            `Image successfully rotated by ${args.angle} degrees to ${args.output_path}`,
            args.output_path
        );
      } catch (error: any) {
        throw new Error(formatErrorMessage("rotate_image", error));
      }
    }

    case "crop_image": {
      try {
       const args = CropImageInputSchema.parse(request.params.arguments);
       const absInputPath = path.resolve(baseDir, args.input_path);
       const absOutputPath = path.resolve(baseDir, args.output_path);
       if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
         throw new Error("Invalid file path: Paths must be within the mounted workspace.");
       }
       
       // ImageMagick crop geometry: widthxheight+x+y
       const cropGeometry = `${args.width}x${args.height}+${args.x}+${args.y}`;
       const command = `convert "${absInputPath}" -crop ${cropGeometry} "${absOutputPath}"`;
       return await runImageMagickCommand(
           command,
           `Image successfully cropped to ${args.width}x${args.height} at (${args.x},${args.y}) and saved to ${args.output_path}`,
           args.output_path
       );
     } catch (error: any) {
       throw new Error(formatErrorMessage("crop_image", error));
     }
   }

    case "flip_flop_image": {
      try {
        const args = FlipFlopImageInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        const absOutputPath = path.resolve(baseDir, args.output_path);
        if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Paths must be within the mounted workspace.");
        }

        const operation = args.direction === 'vertical' ? '-flip' : '-flop';
        const command = `convert "${absInputPath}" ${operation} "${absOutputPath}"`;
        return await runImageMagickCommand(
          command,
          `Image successfully mirrored ${args.direction}ally to ${args.output_path}`,
          args.output_path
        );
      } catch (error: any) {
        throw new Error(formatErrorMessage("flip_flop_image", error));
      }
    }

    case "apply_filter": {
      try {
        const args = ApplyFilterInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        const absOutputPath = path.resolve(baseDir, args.output_path);
        if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Paths must be within the mounted workspace.");
        }

        let filterOption = "";
        switch (args.filter_type) {
          case "grayscale":
            filterOption = "-colorspace Gray";
            break;
          case "sepia":
            filterOption = `-sepia-tone ${args.sepia_percentage}%`;
            break;
          case "blur":
            // Sigma is required if radius is specified and > 0
            const radius_b = args.blur_radius || 0;
            const sigma_b = args.blur_sigma || 1; // Default sigma 1 if radius is 0 or undefined
            filterOption = `-blur ${radius_b}x${sigma_b}`;
            break;
          case "sharpen":
            // Sigma is required if radius is specified and > 0
            const radius_s = args.sharpen_radius || 0;
            const sigma_s = args.sharpen_sigma || 1; // Default sigma 1 if radius is 0 or undefined
            filterOption = `-sharpen ${radius_s}x${sigma_s}`;
            break;
        }

        const command = `convert "${absInputPath}" ${filterOption} "${absOutputPath}"`;
        return await runImageMagickCommand(
          command,
          `Successfully applied ${args.filter_type} filter to ${args.output_path}`,
          args.output_path
        );
      } catch (error: any) {
        throw new Error(formatErrorMessage("apply_filter", error));
      }
    }

    case "get_image_info": {
      try {
        const args = GetImageInfoInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        if (!absInputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Path must be within the mounted workspace.");
        }

        // Use identify -format to get specific details
        // %m = format, %w = width, %h = height, %z = depth, %k = number of colors, %[colorspace], %b = size
        const command = `identify -format "%m %w %h %z %k %[colorspace] %b" "${absInputPath}"`;
        console.error(`Executing command: ${command}`);

        // Identify usually outputs info to stdout, errors to stderr
        const { stdout, stderr } = await execPromise(command);

        if (stderr) {
          // Treat stderr from identify as an error usually
          console.error(`Identify command error: ${stderr}`);
          throw new Error(`Failed to get image info. Stderr: ${stderr}`);
        }

        // Parse the output (space-separated values)
        // Example output: PNG 1024 768 8 65536 sRGB 1.234MB
        const parts = stdout.trim().split(' ');
        if (parts.length < 6) { // Expect format, w, h, depth, colors, colorspace, size 
             // Note: colorspace might be missing, but size should be there
             throw new Error(`Unexpected output format from identify (expected ~6+ parts): ${stdout}`);
        }

        // Size is the last part, might have units like B, KB, MiB
        const fileSize = parts[parts.length - 1];
        const colorspace = parts.length > 6 ? parts[5] : 'Unknown'; // Colorspace is before size if present

        const info = {
          format: parts[0],
          width: parseInt(parts[1], 10),
          height: parseInt(parts[2], 10),
          depth: parseInt(parts[3], 10),
          number_of_colors: parseInt(parts[4], 10),
          colorspace: colorspace,
          file_size: fileSize, // Include the size with units
          raw_output: stdout.trim(),
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                input_path: args.input_path,
                info: info,
              }),
            },
          ],
        };

      } catch (error: any) {
         // Use formatErrorMessage, but adapt it slightly as it's not a modification tool
        console.error(`Error during get_image_info: ${error.message || error}`);
        let errorMessage = `Failed to get image info for ${request.params.arguments?.input_path || 'unknown file'}.`;
        if (error.stderr) errorMessage += ` Stderr: ${error.stderr}`;
        if (error.stdout) errorMessage += ` Stdout: ${error.stdout}`;
        if (error.message && !errorMessage.includes(error.message)) errorMessage += ` Error: ${error.message}`;
        throw new Error(errorMessage);
      }
    }

    case "compress_image": {
      try {
        const args = CompressImageInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        const absOutputPath = path.resolve(baseDir, args.output_path);
        if (!absInputPath.startsWith(baseDir) || !absOutputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Path must be within the mounted workspace.");
        }

        // Use -quality and -strip. Note: -strip removes comments, color profiles, etc.
        const command = `convert "${absInputPath}" -quality ${args.quality} -strip "${absOutputPath}"`;
        return await runImageMagickCommand(
          command,
          `Image successfully compressed (quality ${args.quality}) to ${args.output_path}`,
          args.output_path
        );
      } catch (error: any) {
        throw new Error(formatErrorMessage("compress_image", error));
      }
    }

    case "get_pixel_color": {
      try {
        const args = GetPixelColorInputSchema.parse(request.params.arguments);
        const absInputPath = path.resolve(baseDir, args.input_path);
        if (!absInputPath.startsWith(baseDir)) {
          throw new Error("Invalid file path: Path must be within the mounted workspace.");
        }

        // Use convert with -format to extract pixel color. Escape % for exec.
        const command = `convert "${absInputPath}" -format "%[pixel:p{${args.x},${args.y}}]" info:`;
        console.error(`Executing command: ${command}`);

        const { stdout, stderr } = await execPromise(command);

        if (stderr) {
          // Treat stderr as error for this command
          console.error(`Get pixel color command error: ${stderr}`);
          throw new Error(`Failed to get pixel color. Stderr: ${stderr}`);
        }

        const colorString = stdout.trim();
        if (!colorString) {
            throw new Error("Command did not return color information.");
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                input_path: args.input_path,
                x: args.x,
                y: args.y,
                color: colorString, // e.g., "srgb(255,0,0)" or "red"
              }),
            },
          ],
        };

      } catch (error: any) {
        console.error(`Error during get_pixel_color: ${error.message || error}`);
        let errorMessage = `Failed to get pixel color for ${request.params.arguments?.input_path || 'unknown file'} at (${request.params.arguments?.x}, ${request.params.arguments?.y}).`;
        if (error.stderr && !errorMessage.includes(error.stderr)) errorMessage += ` Stderr: ${error.stderr}`;
        if (error.stdout && !errorMessage.includes(error.stdout)) errorMessage += ` Stdout: ${error.stdout}`;
        if (error.message && !errorMessage.includes(error.message)) errorMessage += ` Error: ${error.message}`;
        throw new Error(errorMessage);
      }
    }

    case "create_collage": {
      try {
        const args = CreateCollageInputSchema.parse(request.params.arguments);
        
        // Resolve and validate all input paths
        const absInputPaths = args.input_paths.map(p => path.resolve(baseDir, p));
        const absOutputPath = path.resolve(baseDir, args.output_path);

        if (!absOutputPath.startsWith(baseDir)) {
           throw new Error("Invalid output file path: Path must be within the mounted workspace.");
        }
        for (const p of absInputPaths) {
            if (!p.startsWith(baseDir)) {
                throw new Error(`Invalid input file path: ${p.replace(baseDir, '.')} must be within the mounted workspace.`);
            }
        }

        // Quote input paths for the command line
        const quotedInputPaths = absInputPaths.map(p => `"${p}"`).join(' ');
        
        // Construct montage command
        const geometryArg = args.border > 0 ? `-geometry +${args.border}+${args.border}` : "";
        const command = `montage ${quotedInputPaths} -tile ${args.tile_geometry} ${geometryArg} -background "${args.background_color}" "${absOutputPath}"`;
        
        return await runImageMagickCommand(
          command,
          `Collage successfully created with layout ${args.tile_geometry} at ${args.output_path}`,
          args.output_path
        );
      } catch (error: any) {
        throw new Error(formatErrorMessage("create_collage", error));
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