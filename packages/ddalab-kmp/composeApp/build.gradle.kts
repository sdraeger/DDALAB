import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import java.net.URL

plugins {
    kotlin("multiplatform") version "2.2.20"
    kotlin("plugin.compose") version "2.2.20"
    kotlin("plugin.serialization") version "2.2.20"
    id("org.jetbrains.compose") version "1.10.2"
}

kotlin {
    jvm("desktop")

    jvmToolchain(21)

    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.ui)
            implementation(compose.components.resources)

            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.7.1")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
        }

        val desktopMain by getting
        desktopMain.dependencies {
            implementation(compose.desktop.currentOs)
        }
    }
}

val repoRootDir = rootProject.projectDir.resolve("../..").canonicalFile
val isWindowsHost = System.getProperty("os.name").lowercase().contains("win")
val ddaBinaryName = if (isWindowsHost) "run_DDA_AsciiEdf.exe" else "run_DDA_AsciiEdf"
val cliBinaryName = if (isWindowsHost) "ddalab.exe" else "ddalab"
val generatedAppResourcesDir = layout.buildDirectory.dir("generated/compose/app-resources")

fun File.ensureExecutable() {
    if (!isWindowsHost) {
        setExecutable(true, false)
    }
}

fun fetchLatestDdaVersion(): String {
    val latestJsonUrl = "https://snl.salk.edu/~sfdraeger/dda/latest.json"
    return runCatching {
        val json = URL(latestJsonUrl).readText()
        """"version"\s*:\s*"([^"]+)"""".toRegex()
            .find(json)
            ?.groupValues
            ?.getOrNull(1)
            ?.takeIf(String::isNotBlank)
    }.getOrNull() ?: "v1.1"
}

fun ensureDdaBinaryAvailable(binary: File) {
    if (binary.exists()) {
        binary.ensureExecutable()
        return
    }

    binary.parentFile.mkdirs()
    val version = fetchLatestDdaVersion()
    val downloadUrl = "https://snl.salk.edu/~sfdraeger/dda/$version/run_DDA_AsciiEdf"
    logger.lifecycle("Downloading bundled DDA binary from $downloadUrl")
    URL(downloadUrl).openStream().use { input ->
        binary.outputStream().use { output -> input.copyTo(output) }
    }
    binary.ensureExecutable()
}

val prepareBundledNativeBinaries by tasks.registering {
    val outputRoot = generatedAppResourcesDir
    outputs.dir(outputRoot)
    outputs.upToDateWhen { false }
    notCompatibleWithConfigurationCache("Stages bundled native binaries for desktop packaging.")

    doLast {
        val ddaBinary = repoRootDir.resolve("bin").resolve(ddaBinaryName)
        ensureDdaBinaryAvailable(ddaBinary)

        val cliBinary = repoRootDir.resolve("packages/dda-cli/target/release").resolve(cliBinaryName)
        if (!cliBinary.exists()) {
            logger.lifecycle("Building bundled dda-cli binary at ${cliBinary.absolutePath}")
            exec {
                workingDir = repoRootDir
                commandLine(
                    "cargo",
                    "build",
                    "--manifest-path",
                    repoRootDir.resolve("packages/dda-cli/Cargo.toml").absolutePath,
                    "--bin",
                    "ddalab",
                    "--release",
                )
            }
        }
        check(cliBinary.exists()) {
            "dda-cli build completed but ${cliBinary.absolutePath} was not found."
        }
        cliBinary.ensureExecutable()

        val commonBinDir = outputRoot.get().dir("common/bin").asFile
        commonBinDir.deleteRecursively()
        commonBinDir.mkdirs()

        ddaBinary.copyTo(commonBinDir.resolve(ddaBinaryName), overwrite = true)
        cliBinary.copyTo(commonBinDir.resolve(cliBinaryName), overwrite = true)
        commonBinDir.resolve(ddaBinaryName).ensureExecutable()
        commonBinDir.resolve(cliBinaryName).ensureExecutable()
    }
}

tasks.configureEach {
    if (name == "prepareAppResources") {
        dependsOn(prepareBundledNativeBinaries)
    }
}

compose.desktop {
    application {
        mainClass = "org.ddalab.kmp.MainKt"

        nativeDistributions {
            appResourcesRootDir.set(generatedAppResourcesDir)
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "DDALAB KMP"
            packageVersion = "1.0.0"
            vendor = "DDALAB"
            description = "Compose Multiplatform desktop port of DDALAB."
        }
    }
}
