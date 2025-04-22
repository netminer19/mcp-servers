# MCP Image Converter Server

This directory contains a Model Context Protocol (MCP) server that provides image manipulation tools by leveraging the power of ImageMagick within a Docker container.

## Purpose

The server allows an MCP client (like Cursor) to request image operations such as format conversion and resizing on files within the mounted workspace.

## Setup

1.  **Build the Docker Image:**
    ```bash
    docker build -t mcp/image-converter .
    ```
2.  **Configure MCP Client:** Add the server definition to your `.cursor/mcp.json` (or project-specific `.cursor/mcp.json`). Ensure you mount your workspace correctly.
    ```json
    {
      "mcpServers": {
        "image-converter": {
          "command": "docker",
          "args": [
            "run",
            "-i",
            "--rm",
            "--mount",
            "type=bind,src=<absolute_path_to_your_workspace>,dst=/workspace",
            "mcp/image-converter"
          ]
        }
        // ... other servers
      }
    }
    ```
    Replace `<absolute_path_to_your_workspace>` with the actual path on your host machine (e.g., `C:/Users/netminer/Documents/workspace/git/mcp-servers`).
3.  **Restart MCP Client:** Restart Cursor (or your MCP client) to load the server.

## Available Tools

### 1. `convert_format`

Converts an image file from one format to another.

**Parameters:**

- `input_path` (string, required): Relative path to the input image file within the workspace.
- `output_path` (string, required): Relative path for the converted output image file within the workspace.
- `target_format` (string, required): The desired output format (e.g., `png`, `jpg`, `webp`, `gif`). The `output_path` extension should typically match this.

**Example Usage (MCP Client):**
"Convert the image `images/input.png` to JPG format, saving it as `images/output.jpg`."

### 2. `resize_image`

Resizes an image to specified dimensions or by a percentage.

**Parameters:**

- `input_path` (string, required): Relative path to the input image file.
- `output_path` (string, required): Relative path for the resized output image file.
- `width` (integer, optional): Target width in pixels.
- `height` (integer, optional): Target height in pixels.
- `percentage` (integer, optional): Percentage to resize by (e.g., 50 for 50%). Overrides width/height if provided.

_Note:_ At least one of `width`, `height`, or `percentage` must be provided. If only one dimension (width or height) is given, ImageMagick preserves the aspect ratio.

**Example Usage (MCP Client):**
"Resize the image `images/input.jpg` to 50% and save it as `images/resized.jpg`."
"Resize `input.png` to a width of 300 pixels, saving as `output_300w.png`."

### 3. `rotate_image`

Rotates an image by a specified number of degrees clockwise.

**Parameters:**

- `input_path` (string, required): Relative path to the input image file.
- `output_path` (string, required): Relative path for the rotated output image file.
- `angle` (number, required): Angle in degrees to rotate the image clockwise (e.g., 90, 180, 270, -90).

**Example Usage (MCP Client):**
"Rotate the image `images/input.png` by 90 degrees clockwise and save it as `images/rotated_90.png`."

### 4. `crop_image`

Crops an image to a specified rectangle, defined by its width, height, and the top-left corner coordinates (x, y).

**Parameters:**

- `input_path` (string, required): Relative path to the input image file.
- `output_path` (string, required): Relative path for the cropped output image file.
- `width` (integer, required): Width of the desired crop area in pixels.
- `height` (integer, required): Height of the desired crop area in pixels.
- `x` (integer, required): X-coordinate (horizontal offset from the left edge) of the top-left corner of the crop area.
- `y` (integer, required): Y-coordinate (vertical offset from the top edge) of the top-left corner of the crop area.

**Example Usage (MCP Client):**
"Crop the image `images/input.jpg` to a 100x150 pixel area starting at coordinate (50, 25), saving it as `images/cropped_area.jpg`."

### 5. `flip_flop_image`

Mirrors an image vertically (flip) or horizontally (flop).

**Parameters:**

- `input_path` (string, required): Relative path to the input image file.
- `output_path` (string, required): Relative path for the mirrored output image file.
- `direction` (enum, required): The direction of mirroring. Must be either `"vertical"` (for flip) or `"horizontal"` (for flop).

**Example Usage (MCP Client):**
"Flip the image `images/input.png` vertically and save it as `images/flipped.png`."
"Flop the image `images/input.jpg` horizontally and save it as `images/flopped.jpg`."

### 6. `apply_filter`

Applies a common filter (grayscale, sepia, blur, sharpen) to an image.

**Parameters:**

- `input_path` (string, required): Relative path to the input image file.
- `output_path` (string, required): Relative path for the filtered output image file.
- `filter_type` (enum, required): The type of filter to apply. Must be one of: `"grayscale"`, `"sepia"`, `"blur"`, `"sharpen"`.
- `blur_radius` (number, optional): Radius for the blur filter. Use with `blur_sigma`. Defaults to 0.
- `blur_sigma` (number, optional): Sigma (standard deviation) for the blur filter. Required if `blur_radius` > 0. Defaults to 1.
- `sepia_percentage` (integer, optional): Percentage for the sepia tone effect (0-100). Defaults to 80.
- `sharpen_radius` (number, optional): Radius for the sharpen filter. Use with `sharpen_sigma`. Defaults to 0.
- `sharpen_sigma` (number, optional): Sigma (standard deviation) for the sharpen filter. Required if `sharpen_radius` > 0. Defaults to 1.

**Example Usage (MCP Client):**
"Apply grayscale filter to `images/input.png` and save as `images/grayscale.png`."
"Apply a sepia filter to `images/photo.jpg`, saving as `images/sepia_photo.jpg`."
"Apply a blur filter with radius 0 and sigma 5 to `images/details.png`, saving as `images/blurred.png`."
"Apply a sharpen filter with radius 1 and sigma 2 to `images/soft.jpg`, saving as `images/sharpened.jpg`."

### 7. `get_image_info`

Retrieves metadata information about an image, such as format, dimensions, color depth, number of colors, and colorspace.

**Parameters:**

- `input_path` (string, required): Relative path to the input image file.

**Returns:**
A JSON object containing the image information, including:

- `format` (string): Image format (e.g., "PNG", "JPEG").
- `width` (integer): Width in pixels.
- `height` (integer): Height in pixels.
- `depth` (integer): Color depth (bits per sample).
- `number_of_colors` (integer): Number of unique colors in the image (may be large or approximate).
- `colorspace` (string): Colorspace identifier (e.g., "sRGB", "Gray").
- `raw_output` (string): The raw output string from the `identify` command.

**Example Usage (MCP Client):**
"Get image information for `images/logo.png`."

---

_More tools coming soon!_
