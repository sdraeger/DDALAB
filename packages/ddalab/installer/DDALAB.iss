#define AppName "DDALAB"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #error SourceDir must point at the frozen DDALAB directory.
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#define AppIconFile SourcePath + "..\\ddalab_qt\\assets\\icons\\icon.ico"

[Setup]
AppId=ddalab-desktop
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=DDALAB
DefaultDirName={localappdata}\Programs\DDALAB
DefaultGroupName=DDALAB
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=DDALAB-{#AppVersion}-windows-x64-installer
Compression=lzma
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=yes
SetupLogging=yes
SetupIconFile={#AppIconFile}
UninstallDisplayIcon={app}\DDALAB.exe

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\DDALAB"; Filename: "{app}\DDALAB.exe"
Name: "{autodesktop}\DDALAB"; Filename: "{app}\DDALAB.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\DDALAB.exe"; Description: "Launch DDALAB"; Flags: nowait postinstall skipifsilent
