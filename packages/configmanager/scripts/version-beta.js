const fs = require("fs");
const path = require("path");

function updateVersion(type = "patch") {
  const packagePath = path.join(__dirname, "../package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  const currentVersion = packageJson.version;
  const [major, minor, patch] = currentVersion.split(".").map(Number);

  let newVersion;
  switch (type) {
    case "major":
      newVersion = `${major + 1}.0.0-beta.1`;
      break;
    case "minor":
      newVersion = `${major}.${minor + 1}.0-beta.1`;
      break;
    case "patch":
    default:
      newVersion = `${major}.${minor}.${patch + 1}-beta.1`;
      break;
  }

  packageJson.version = newVersion;

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");

  console.log(`Version updated from ${currentVersion} to ${newVersion}`);
  return newVersion;
}

// Get version type from command line argument
const versionType = process.argv[2] || "patch";
updateVersion(versionType);
