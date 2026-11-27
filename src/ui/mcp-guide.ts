export type McpConnection = {
  command: string;
  args: string[];
  projectDirectory: string;
  materialLibrary?: string;
  electron?: boolean;
  portable?: boolean;
};
export const sourceConnection: McpConnection = {
  command: "node",
  args: ["C:/path/to/Wam Local/dist-mcp/server.mjs"],
  projectDirectory: "C:/WamLocal/Jobs",
};
export function mcpConfiguration(c: McpConnection) {
  return {
    mcpServers: {
      "wam-local": {
        command: c.command,
        args: c.args,
        env: {
          ...(c.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          WAM_PROJECT_DIR: c.projectDirectory,
          ...(c.materialLibrary
            ? { WAM_MATERIAL_LIBRARY: c.materialLibrary }
            : {}),
        },
      },
    },
  };
}
export const MCP_TOOL_GROUPS = [
  {
    title: "Jobs, parts & sheets",
    description: "Use these for normal .wam jobs.",
    tools: [
      "create_job",
      "read_job",
      "write_job",
      "add_job_part",
      "update_job_part",
      "add_sheet",
      "update_sheet",
      "nest_job",
      "inspect_job",
      "list_workspace",
      "save_job_as",
      "configure_job",
      "job_history",
      "start_nesting",
      "nesting_status",
      "stop_nesting",
    ],
  },
  {
    title: "Drawing & placement",
    description:
      "Import artwork, edit parts and cut controls, and arrange copies on sheets.",
    tools: [
      "import_parts",
      "create_part",
      "edit_part",
      "edit_contour",
      "delete_parts",
      "duplicate_parts",
      "place_part",
      "edit_placements",
      "remove_sheet",
      "nest_sheet",
      "export_job_svg",
      "simulate_sheet",
    ],
  },
  {
    title: "Materials & posting",
    description:
      "Read shared presets, calculate thickness settings and write machine cut files.",
    tools: [
      "read_material_library",
      "query_material_presets",
      "write_material_library",
      "estimate_material_settings",
      "post_sheet",
      "post_all",
      "apply_job_material",
      "edit_material_preset",
      "application_settings",
      "setting_default",
    ],
  },
  {
    title: "Legacy project tools",
    description:
      "Version-1 project operations. The reference-preset application tool targets version-1 projects; use read_material_library and write_job for job materials.",
    tools: [
      "create_project",
      "read_project",
      "write_project",
      "add_shape",
      "update_part",
      "nest_project",
      "inspect_toolpaths",
      "export_svg",
      "list_material_presets",
      "apply_material_preset",
    ],
  },
] as const;
export const MCP_TOOL_COUNT = MCP_TOOL_GROUPS.reduce(
  (n, g) => n + g.tools.length,
  0,
);
export function mcpTestPrompt(machine: "desktop" | "pro") {
  return `Use the connected wam-local MCP server to run this small end-to-end test for WAZER ${machine === "pro" ? "Pro" : "Desktop"}. Create files only in the configured WAM_PROJECT_DIR. Never overwrite an existing job or cut file; if a target exists, stop and report it.

1. Discover the tools, then create_job with file "mcp-smoke-test.wam", name "ZZ MCP Smoke Test" and machine "${machine}". Read the returned IDs; do not invent replacement IDs for existing materials or sheets.
2. Call read_material_library and select the ${machine} Aluminum - 6061 profile at 3 mm, medium quality. Use only a same-machine profile. Assign it to the job, every part and every sheet. Use write_job to save the complete updated job; apply_material_preset is a legacy-project tool.
3. Set the initial sheet to 150 x 100 mm, edge margin 5 mm, part spacing 3 mm and top-left sheet origin. Set job tabRules.count to 0 for this test. Keep the selected material's feed, pierce and lead settings. Geometry, coordinates and process lengths in MCP inputs are always millimetres, regardless of the UI unit toggle.
4. Add two reusable part definitions using add_job_part: "Plate", quantity 3, a 40 x 25 mm rectangle with a centered 8 mm diameter hole; and "Bracket", quantity 2, a solid 30 x 20 mm rectangle. Use closed contours, hole=true for the circular hole, identity transforms and outside cuts. Approximate the circle with 128 segments. Use the actual job material ID.
5. Call nest_job, then inspect_job. Check nestingResult for unplaced quantities and inspect every preflight issue. Expect five placed copies on one populated sheet and eight closed cut profiles. Stop and report any error before posting.
6. If preflight passes, call post_all with replace=false. This generates files only; it does not operate the waterjet. Expect one .gcode file and eight piercing/cutting operations, with no tab gaps.
7. Read_job again. Report the .wam and .gcode paths, machine, material, thickness, quality, placed/requested counts, sheet count, estimated time, abrasive consumption and cost. Identify any cost fields that are unavailable. Tell me which .wam file to open in Wam Local to inspect the result.`;
}
