import { useEffect, useState } from "react";
import {
  mcpConfiguration,
  mcpTestPrompt,
  MCP_TOOL_GROUPS,
  MCP_TOOL_COUNT,
  sourceConnection,
  type McpConnection,
} from "./mcp-guide";
export function McpPage({
  machine,
  onMessage,
}: {
  machine: "desktop" | "pro";
  onMessage: (text: string) => void;
}) {
  const [connection, setConnection] = useState<McpConnection>(sourceConnection),
    [testMachine, setTestMachine] = useState(machine);
  useEffect(() => {
    let active = true;
    window.mcpSetup
      ?.load()
      .then((c) => {
        if (active) setConnection(c);
      })
      .catch((e) => onMessage("Could not load MCP paths: " + e.message));
    return () => {
      active = false;
    };
  }, []);
  const configuration = JSON.stringify(mcpConfiguration(connection), null, 2),
    prompt = mcpTestPrompt(testMachine);
  async function copy(text: string) {
    try {
      if (window.mcpSetup) await window.mcpSetup.copy(text);
      else await navigator.clipboard.writeText(text);
      onMessage("Copied to clipboard");
    } catch {
      onMessage(
        "Clipboard unavailable. Select the text and copy it with Ctrl+C.",
      );
    }
  }
  return (
    <main className="workspace full-page mcp-page">
      <header>
        <h1>MCP server</h1>
        <p>
          Connect an MCP client to create jobs, edit vector parts, nest
          quantities and generate WAZER cut files.
        </p>
      </header>
      <section className="mcp-getting-started">
        <h2>Connect your client</h2>
        <ol>
          <li>
            Open your client's MCP server settings and add a local{" "}
            <strong>stdio</strong> server named <strong>wam-local</strong>.
          </li>
          <li>
            Use the configuration below. Clients with JSON configuration can use
            the <code>mcpServers</code> block; form-based clients need the
            command, arguments and environment values separately.
          </li>
          <li>
            Save and enable the server, then reconnect or restart the client if
            needed. It receives workflow instructions automatically and should
            discover {MCP_TOOL_COUNT} tools, including <code>create_job</code>,{" "}
            <code>nest_job</code>, <code>inspect_job</code> and{" "}
            <code>post_all</code>.
          </li>
          <li>
            Paste the test prompt into the connected client's chat. Open the
            resulting .wam file in Wam Local to review the geometry and sheets.
          </li>
        </ol>
        <p>
          The client starts and stops the server on demand. There is no server
          port, URL, API key or background service to configure. Files are
          written to the job folder below.
        </p>
      </section>
      <div className="mcp-setup-grid">
        <section className="settings-card">
          <h2>Client configuration</h2>
          <label className="field">
            <span>Server command</span>
            <input
              aria-label="MCP server command"
              value={connection.command}
              onChange={(e) =>
                setConnection({ ...connection, command: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Server script argument</span>
            <input
              aria-label="MCP server script"
              value={connection.args[0] ?? ""}
              onChange={(e) =>
                setConnection({ ...connection, args: [e.target.value] })
              }
            />
          </label>
          <label className="field">
            <span>Job folder · WAM_PROJECT_DIR</span>
            <input
              aria-label="MCP job folder"
              value={connection.projectDirectory}
              onChange={(e) =>
                setConnection({
                  ...connection,
                  projectDirectory: e.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span>Shared material database · WAM_MATERIAL_LIBRARY</span>
            <input
              aria-label="MCP material database"
              placeholder="Server's default local material library"
              value={connection.materialLibrary ?? ""}
              onChange={(e) =>
                setConnection({
                  ...connection,
                  materialLibrary: e.target.value || undefined,
                })
              }
            />
          </label>
          <p>
            {connection.electron
              ? "These paths point to this desktop build and its shared presets. The main window can be closed while the client runs the server."
              : "For a source build, run npm install and npm run build in the repository, then replace the script path with the absolute path to dist-mcp/server.mjs. This builds the import renderer too. Node.js must be available to the client."}
          </p>
          {connection.portable && (
            <p>
              Portable launches extract their runtime to a temporary folder. Use
              an installed or unpacked build for persistent client paths.
            </p>
          )}
          <textarea
            aria-label="MCP client configuration"
            readOnly
            value={configuration}
            rows={15}
          />
          <button onClick={() => void copy(configuration)}>
            Copy configuration
          </button>
        </section>
        <section className="settings-card">
          <h2>Sample / test prompt</h2>
          <label className="field">
            <span>Test machine</span>
            <select
              aria-label="MCP test machine"
              value={testMachine}
              onChange={(e) => setTestMachine(e.target.value as typeof machine)}
            >
              <option value="desktop">WAZER Desktop</option>
              <option value="pro">WAZER Pro</option>
            </select>
          </label>
          <p>
            This creates one small job, nests five copies and posts one cut
            file. It does not send commands to the machine.
          </p>
          <textarea
            aria-label="MCP test prompt"
            readOnly
            value={prompt}
            rows={25}
          />
          <button onClick={() => void copy(prompt)}>Copy test prompt</button>
        </section>
      </div>
      <section>
        <h2>Available tools</h2>
        <div className="mcp-tool-groups">
          {MCP_TOOL_GROUPS.map((g) => (
            <article className="settings-card" key={g.title}>
              <h3>{g.title}</h3>
              <p>{g.description}</p>
              <ul>
                {g.tools.map((t) => (
                  <li key={t}>
                    <code>{t}</code>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <div className="mcp-setup-grid">
        <section className="settings-card">
          <h2>Working with saved jobs</h2>
          <ul>
            <li>
              Save the job in the editor before automating changes to the same
              file. MCP edits saved files, not the unsaved canvas. Reopen after
              automation.
            </li>
            <li>
              Use simple relative filenames such as <code>bracket.wam</code>;
              geometry and process lengths use millimetres. Feeds use mm/min,
              pierce times seconds and abrasive g/min.
            </li>
            <li>
              Choose the machine before selecting a preset. Shared jobs use one
              material and sheet template; part definitions carry quantities and
              contours, sheets carry placements.
            </li>
            <li>
              After nesting, check <code>nestingResult</code> for partial
              layouts. Inspect before posting. <code>post_sheet</code> or{" "}
              <code>post_all</code> returns file paths, cut time, abrasive use
              and cost estimates.
            </li>
            <li>
              Use <code>import_parts</code> for SVG, DXF and raster artwork,
              <code>edit_contour</code> for nodes, tabs and lead-ins, and
              <code>simulate_sheet</code> for timed motion and valve states.
              Imports use the editor's Chromium tracing pipeline. Put drawings
              and linked assets in the job folder, or supply inline SVG/DXF
              data.
            </li>
            <li>
              <code>application_settings</code> manages machine profiles, costs,
              units and import settings. <code>setting_default</code> saves or
              resolves material-specific or global defaults.
              <code>job_history</code> provides session undo/redo. These file
              tools do not control the live editor window or physical machine.
            </li>
          </ul>
        </section>
        <section className="settings-card">
          <h2>Troubleshooting</h2>
          <dl>
            <dt>The server will not start</dt>
            <dd>
              Check the executable and script paths. Keep command and arguments
              separate; spaces in paths are handled by the JSON strings. For
              source builds, build the MCP bundle first.
            </dd>
            <dt>No tools appear</dt>
            <dd>
              Enable the server and reconnect the client. Inspect its MCP
              stderr/error log. A stdio server waits for protocol input; no
              welcome banner is expected in a terminal.
            </dd>
            <dt>A job cannot be opened or saved</dt>
            <dd>
              Check WAM_PROJECT_DIR, folder permissions and filename format.
              Absolute job filenames and directory traversal are rejected.
            </dd>
            <dt>Nesting or posting fails</dt>
            <dd>
              Read the returned issues. Check material/machine matches,
              quantities, stock bounds and contour geometry. Existing output
              files require an explicit replacement request.
            </dd>
          </dl>
        </section>
      </div>
    </main>
  );
}
