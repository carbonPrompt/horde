; Horde installer (Inno Setup 6). Per-user install: no admin prompt.
#ifndef AppVer
  #define AppVer "0.0.0"
#endif
[Setup]
AppId={{6B1F2C1E-4D7A-4C55-9E3B-2F6A0D7C8E41}
AppName=Horde
AppVersion={#AppVer}
AppVerName=Horde {#AppVer}
AppPublisher=Horde
DefaultDirName={localappdata}\Programs\Horde
DefaultGroupName=Horde
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\out
OutputBaseFilename=Horde-Setup-{#AppVer}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Horde.exe
UninstallDisplayName=Horde
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\out\Horde\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{userprograms}\Horde"; Filename: "{app}\Horde.exe"
Name: "{userdesktop}\Horde"; Filename: "{app}\Horde.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Horde.exe"; Description: "Play Horde now"; Flags: nowait postinstall skipifsilent
; 0.26: an update started from inside the game passes /LAUNCH so the game reopens after a silent install
Filename: "{app}\Horde.exe"; Flags: nowait; Check: WantLaunch

[Code]
function WantLaunch: Boolean;
begin
  Result := Pos('/LAUNCH', UpperCase(GetCmdTail)) > 0;
end;
