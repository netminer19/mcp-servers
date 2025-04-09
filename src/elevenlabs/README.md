![export](https://github.com/user-attachments/assets/ee379feb-348d-48e7-899c-134f7f7cd74f)

<div class="title-block" style="text-align: center;" align="center">

  [![Discord Community](https://img.shields.io/badge/discord-@elevenlabs-000000.svg?style=for-the-badge&logo=discord&labelColor=000)](https://discord.gg/elevenlabs)
  [![Twitter](https://img.shields.io/badge/Twitter-@elevenlabsio-000000.svg?style=for-the-badge&logo=twitter&labelColor=000)](https://x.com/ElevenLabsDevs)
  [![PyPI](https://img.shields.io/badge/PyPI-elevenlabs--mcp-000000.svg?style=for-the-badge&logo=pypi&labelColor=000)](https://pypi.org/project/elevenlabs-mcp)
  [![Tests](https://img.shields.io/badge/tests-passing-000000.svg?style=for-the-badge&logo=github&labelColor=000)](https://github.com/elevenlabs/elevenlabs-mcp-server/actions/workflows/test.yml)

</div>


<p align="center">
  Official ElevenLabs Model Context Protocol (MCP) server that enables interaction with powerful Text to Speech and audio processing APIs. This server allows MCP clients like <a href="https://www.anthropic.com/claude">Claude Desktop</a>, <a href="https://www.cursor.so">Cursor</a>, <a href="https://codeium.com/windsurf">Windsurf</a>, <a href="https://github.com/openai/openai-agents-python">OpenAI Agents</a> and others to generate speech, clone voices, transcribe audio, and more.
</p>

## Quickstart with Claude Desktop

1. Get your API key from [ElevenLabs](https://elevenlabs.io/app/settings/api-keys). There is a free tier with 10k credits per month.
2. Install `uv` (Python package manager), install with `curl -LsSf https://astral.sh/uv/install.sh | sh` or see the `uv` [repo](https://github.com/astral-sh/uv) for additional install methods.
3. Go to Claude > Settings > Developer > Edit Config > claude_desktop_config.json to include the following:

```
{
  "mcpServers": {
    "ElevenLabs": {
      "command": "uvx",
      "args": ["elevenlabs-mcp"],
      "env": {
        "ELEVENLABS_API_KEY": "<insert-your-api-key-here"
      }
    }
  }
}

```

If you're using Windows, you will have to enable "Developer Mode" in Claude Desktop to use the MCP server. Click "Help" in the hamburger menu in the top left and select "Enable Developer Mode".

## Other MCP clients

For other clients like Cursor and Windsurf, run:
1. `pip install elevenlabs-mcp`
2. `python -m elevenlabs_mcp --api-key={{PUT_YOUR_API_KEY_HERE}} --print` to get the configuration. Paste it into appropriate configuration directory specified by your MCP client.

## Docker Setup for Cursor (Manual)

Alternatively, you can run this server within a Docker container, which is useful for environments like Cursor where multiple MCP servers are managed.

1.  **Clone the Repository:**
    Ensure you have cloned this repository into your project structure (e.g., `your-project/src/elevenlabs`).

2.  **Create a Dockerfile:**
    Place the following content into `src/elevenlabs/Dockerfile`:

    ```Dockerfile
    # Use a Python image with uv pre-installed
    FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS uv

    # Install the project into `/app`
    WORKDIR /app

    # Enable bytecode compilation
    ENV UV_COMPILE_BYTECODE=1

    # Copy from the cache instead of linking since it's a mounted volume
    ENV UV_LINK_MODE=copy

    # Install the project's dependencies using the lockfile and settings
    RUN --mount=type=cache,target=/root/.cache/uv \
        --mount=type=bind,source=uv.lock,target=uv.lock \
        --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
        uv sync --frozen --no-install-project --no-dev --no-editable

    # Then, add the rest of the project source code and install it
    # Installing separately from its dependencies allows optimal layer caching
    ADD . /app
    RUN --mount=type=cache,target=/root/.cache/uv \
        uv sync --frozen --no-dev --no-editable

    FROM python:3.12-slim-bookworm

    WORKDIR /app

    # Copy the entire built application from the uv stage
    COPY --from=uv /app /app

    # Place executables in the environment at the front of the path
    ENV PATH="/app/.venv/bin:$PATH"

    # This is the main script defined in pyproject.toml
    ENTRYPOINT ["elevenlabs-mcp"]
    ```

3.  **Build the Docker Image:**
    Navigate to the `src/elevenlabs` directory in your terminal and run:

    ```bash
    docker buildx build --load -t mcp/elevenlabs .
    ```

4.  **Configure Cursor (`mcp.json`):**
    Add the following configuration to your Cursor MCP settings file (e.g., `~/.cursor/mcp.json`). Replace `sk_...` with your actual ElevenLabs API key.

    ```json
    {
      "mcpServers": {
        // ... other servers ...
        "elevenlabs": {
          "command": "docker",
          "args": [
            "run",
            "-i",
            "--rm",
            "--mount", "type=bind,src=/path/to/your/project/src/elevenlabs/elevenlabs_output,dst=/data", // Adjust host path
            "-e", "ELEVENLABS_MCP_BASE_PATH=/data",
            "-e", "ELEVENLABS_API_KEY=sk_...", // Replace with your key
            "mcp/elevenlabs"
          ]
        }
      }
    }
    ```
    *   **Important:** Adjust the host path in the `--mount` argument to point to the desired output directory on your machine (e.g., `/Users/netminer/workspace/mcp-servers/src/elevenlabs/elevenlabs_output`). Create this directory if it doesn't exist.

5.  **Restart Cursor:**
    After updating the configuration, restart Cursor.

6.  **File Output Note:**
    As of testing, the `ELEVENLABS_MCP_BASE_PATH` environment variable doesn't seem to correctly redirect file outputs. Files generated by tools like `text_to_speech` are saved to `/root/Desktop/` inside the container by default. To access them via your mounted volume (`/data` -> your host path), you currently need to manually copy them using `docker exec`:

    ```bash
    # Find the container ID
    docker ps --filter ancestor=mcp/elevenlabs --format "{{.ID}}"
    # Copy the file (replace <container_id> and <filename>)
    docker exec <container_id> cp /root/Desktop/<filename> /data/
    ```

That's it. Your MCP client can now interact with ElevenLabs through these tools:

## Example usage

⚠️ Warning: ElevenLabs credits are needed to use these tools.

Try asking Claude:

- "Create an AI agent that speaks like a film noir detective and can answer questions about classic movies"
- "Generate three voice variations for a wise, ancient dragon character, then I will choose my favorite voice to add to my voice library"
- "Convert this recording of my voice to sound like a medieval knight"
- "Create a soundscape of a thunderstorm in a dense jungle with animals reacting to the weather"
- "Turn this speech into text, identify different speakers, then convert it back using unique voices for each person"

## Optional features

You can add the `ELEVENLABS_MCP_BASE_PATH` environment variable to the `claude_desktop_config.json` to specify the base path MCP server should look for and output files specified with relative paths.

## Contributing

If you want to contribute or run from source:

1. Clone the repository:

```bash
git clone https://github.com/elevenlabs/elevenlabs-mcp
cd elevenlabs-mcp
```

2. Create a virtual environment and install dependencies [using uv](https://github.com/astral-sh/uv):

```bash
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
```

3. Copy `.env.example` to `.env` and add your ElevenLabs API key:

```bash
cp .env.example .env
# Edit .env and add your API key
```

4. Run the tests to make sure everything is working:

```bash
./scripts/test.sh
# Or with options
./scripts/test.sh --verbose --fail-fast
```

5. Install the server in Claude Desktop: `mcp install elevenlabs_mcp/server.py`

6. Debug and test locally with MCP Inspector: `mcp dev elevenlabs_mcp/server.py`

## Troubleshooting

Logs when running with Claude Desktop can be found at:

- **Windows**: `%APPDATA%\Claude\logs\mcp-server-elevenlabs.log`
- **macOS**: `~/Library/Logs/Claude/mcp-server-elevenlabs.log`

### Timeouts when using certain tools

Certain ElevenLabs API operations like voice design and audio isolation can take a long time to resolve. When using the MCP inspector in dev mode you might get timeout errors, despite the tool completing its intended task.

This shouldn't occur when using a client like Claude.
