import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { join, dirname, basename, extname } from "path";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedPath = searchParams.get("path") || "/";

    // Security: Only allow access within the workspace
    const workspaceRoot = process.cwd();
    const dataPath = join(workspaceRoot, "data");

    // Resolve the requested path relative to the data directory
    let targetPath: string;
    if (requestedPath === "/") {
      targetPath = dataPath;
    } else {
      // Remove leading slash and join with data path
      const relativePath = requestedPath.replace(/^\/+/, "");
      targetPath = join(dataPath, relativePath);
    }

    // Security check: ensure the target path is within the allowed directory
    const resolvedTarget = require("path").resolve(targetPath);
    const resolvedData = require("path").resolve(dataPath);

    if (!resolvedTarget.startsWith(resolvedData)) {
      return NextResponse.json(
        {
          error: "Access denied: Path outside workspace",
        },
        { status: 403 }
      );
    }

    // Check if the path exists
    try {
      await fs.access(targetPath);
    } catch (error) {
      // If data directory doesn't exist, try the workspace root
      if (requestedPath === "/") {
        targetPath = workspaceRoot;
      } else {
        return NextResponse.json(
          {
            error: "Path not found",
          },
          { status: 404 }
        );
      }
    }

    // Read directory contents
    const entries = await fs.readdir(targetPath, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(targetPath, entry.name);

        try {
          const stats = await fs.stat(fullPath);
          const extension = entry.isFile()
            ? extname(entry.name).slice(1).toLowerCase()
            : undefined;

          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: entry.isFile() ? stats.size : undefined,
            modified: stats.mtime,
            extension: extension || undefined,
          };
        } catch (error) {
          // If we can't stat the file, still include it with basic info
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            extension: entry.isFile()
              ? extname(entry.name).slice(1).toLowerCase() || undefined
              : undefined,
          };
        }
      })
    );

    // Filter out hidden files and system files for security
    const filteredFiles = files.filter(
      (file) =>
        !file.name.startsWith(".") &&
        !file.name.startsWith("__pycache__") &&
        file.name !== "node_modules"
    );

    return NextResponse.json({
      files: filteredFiles,
      currentPath: requestedPath,
      actualPath: targetPath === dataPath ? "/data" : requestedPath,
    });
  } catch (error) {
    console.error("Error reading directory:", error);
    return NextResponse.json(
      {
        error: "Failed to read directory",
      },
      { status: 500 }
    );
  }
}
