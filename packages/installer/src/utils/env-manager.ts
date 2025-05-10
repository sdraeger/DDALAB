import path from "path";
import fs from "fs";

export const PROJECT_ROOT_ENV_PATH = path.resolve(
  __dirname,
  "..", // from dist/src/utils to dist/src
  "..", // from dist/src to dist
  "..", // from dist to packages/installer
  "..", // from packages/installer to packages
  "..", // from packages to root
  ".env" // .env in the DDALAB project root
);

export interface ParsedEnvEntry {
  key: string;
  value: string;
  comments: string[];
}

export async function loadEnvVars(): Promise<ParsedEnvEntry[] | undefined> {
  const filePathToLoad = PROJECT_ROOT_ENV_PATH;
  const pathType = "Project Root .env";

  console.log(
    `[env-manager.ts] Attempting to load exclusively: ${pathType} from ${filePathToLoad}`
  );

  try {
    const exists = fs.existsSync(filePathToLoad);
    console.log(
      `[env-manager.ts] Path ${filePathToLoad} (Type: ${pathType}) - Exists: ${exists}`
    );

    if (!exists) {
      console.warn(
        `[env-manager.ts] ${pathType} not found at ${filePathToLoad}. No .env file will be loaded.`
      );
      return undefined;
    }

    console.log(
      `[env-manager.ts] Reading final selected file: ${filePathToLoad}`
    );
    const content = await fs.promises.readFile(filePathToLoad, "utf-8");
    const lines = content.split(/\r?\n/);
    const entries: ParsedEnvEntry[] = [];
    let currentComments: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith("#")) {
        const commentText = trimmedLine.substring(1).trim();
        currentComments.push(commentText);
      } else {
        const LIKELY_ENV_LINE_WITH_EQUALS = /^\s*([\w.-]+)\s*=\s*(.*)/;
        const match = trimmedLine.match(LIKELY_ENV_LINE_WITH_EQUALS);

        if (match) {
          const key = match[1];
          let value = match[2].trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.substring(1, value.length - 1);
          }
          entries.push({ key, value, comments: currentComments });
          currentComments = [];
        } else if (trimmedLine !== "") {
          // Non-comment, non-assignment line, reset comments for next valid entry
          currentComments = [];
        }
      }
    }
    console.log(
      `[env-manager.ts] Successfully parsed ${entries.length} entries from ${filePathToLoad}`
    );
    return entries;
  } catch (error: any) {
    console.error(
      `[env-manager.ts] Error reading/parsing ${pathType} at ${filePathToLoad}: ${error.message}`
    );
    return undefined;
  }
}

export function saveEnvConfig(
  targetDirOrSignal: string | null,
  content: string
): void {
  let filePath: string;
  if (targetDirOrSignal && targetDirOrSignal !== "PROJECT_ROOT") {
    filePath = path.join(targetDirOrSignal, ".env");
  } else {
    filePath = PROJECT_ROOT_ENV_PATH;
  }

  if (!filePath) {
    console.error(
      "[env-manager.ts] Target file path could not be determined. Cannot save .env file."
    );
    return;
  }

  try {
    console.log(`[env-manager.ts] Attempting to save .env to: ${filePath}`);
    const dirName = path.dirname(filePath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
      console.log(`[env-manager.ts] Created directory: ${dirName}`);
    }
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(
      `[env-manager.ts] .env file saved successfully to ${filePath}.`
    );
  } catch (error: any) {
    console.error(
      `[env-manager.ts] Failed to save .env file to ${filePath}: ${error.message}`
    );
  }
}
