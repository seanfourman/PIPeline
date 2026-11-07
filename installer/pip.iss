; PipSetup.exe: one file that puts Pip on a Windows computer, for the user who runs it and with no admin rights: the
; program's files (staged by build.ts into stage\app) and its launcher (Pip.exe, launcher.cs); then what it needs
; that the computer doesn't have yet (Bun, Python, MiKTeX) and its packages, a step at a time on the wizard's
; installing page ([Code]); its shortcuts; and Pip started at the end. Everything it downloads, it downloads itself
; and checks against the checksum it has for it before using it; no script runs anything, it runs the programs
; themselves. Running it again over an install mends whatever failed and leaves the user's folder (user\) as it is;
; so does removing it, which takes away only what the installer and the program put in beside it. The wizard speaks
; Hebrew or English with Windows, its Hebrew addressing no one as a man or a woman. Pip runs it itself, unseen, to
; update (launcher.cs, with /UPDATE=1): then the steps only a first install needs are left out, and Pip starts again in
; the background, as it was.
; Build: bun installer/build.ts (it needs Inno Setup 6). AppName and AppId can be given to ISCC (/D) to build a copy
; that installs beside Pip under another name, to try an update without touching Pip.

#ifndef AppName
  #define AppName "Pip"
#endif
#ifndef AppId
  #define AppId "{{6C3B2E8A-4F1D-4B9E-A7C2-9D5E1F0A3B64}"
#endif
#define AppVersion "1.0.0"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName}
AppPublisher={#AppName}
DefaultDirName={userpf}\{#AppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=no
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=out
OutputBaseFilename=PipSetup
SetupIconFile=stage\pip.ico
UninstallDisplayIcon={app}\Pip.exe
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppName}
VersionInfoDescription={#AppName} Setup
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
WizardStyle=modern
WizardImageFile=stage\wizard.bmp
WizardSmallImageFile=stage\wizard-small.bmp
Compression=lzma2/max
SolidCompression=yes
ShowLanguageDialog=auto
LanguageDetectionMethod=uilanguage
CloseApplications=no
; Tells Explorer at the end to draw its icons afresh, so an install over an older one shows Pip's icon as it is now,
; not the one it kept from before.
ChangesAssociations=yes

[Languages]
Name: "he"; MessagesFile: "compiler:Languages\Hebrew.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Messages]
he.SetupAppTitle=התקנת פיפ
he.SetupWindowTitle=התקנת פיפ
he.WelcomeLabel1=שלום, אני פיפ!
he.WelcomeLabel2=אני אתקין את עצמי במחשב הזה: את התוכנה, ומה שהיא צריכה ועוד אין כאן. זה לוקח כמה דקות, ואחר כך נמשיך בדפדפן.
he.ButtonBack=< ה&קודם
he.ButtonNext=ה&בא >
he.ButtonInstall=&התקנה
he.ButtonCancel=ביטול
he.ButtonFinish=&סיום
he.WizardSelectTasks=עוד כמה דברים
he.SelectTasksDesc=מה עוד להוסיף?
he.SelectTasksLabel2=אפשר לבחור מה עוד להוסיף, ואז "התקנה".
he.WizardInstalling=מתקין
he.InstallingLabel=רגע, אני מתקין את עצמי במחשב.
he.StatusExtractFiles=מעתיק את הקבצים...
he.StatusRunProgram=מסיים...
he.FinishedHeadingLabel=פיפ במחשב!
he.FinishedLabelNoIcons=פיפ מותקן במחשב הזה.
he.FinishedLabel=פיפ מותקן במחשב הזה, ואפשר להפעיל אותו מקיצור הדרך Pip.
he.ClickFinish="סיום" יוצא מההתקנה.
he.ExitSetupTitle=יציאה מההתקנה
he.ExitSetupMessage=ההתקנה עוד לא הסתיימה, ופיפ לא יעבוד בלעדיה. אפשר להריץ אותה שוב מתי שרוצים.%n%nלצאת בכל זאת?
he.ConfirmUninstall=להסיר את פיפ מהמחשב? התיקייה user, עם כל מה שנשמר בה, נשארת.
he.UninstallStatusLabel=רגע, מסיר את %1 מהמחשב.
he.UninstalledAll=פיפ הוסר מהמחשב.
he.UninstalledMost=פיפ הוסר. נשאר מה שנשמר בתיקייה user, ואפשר למחוק אותה ביד.
he.SelectLanguageTitle=שפת ההתקנה
he.SelectLanguageLabel=באיזו שפה להתקין?
he.SetupAborted=ההתקנה לא הושלמה.%n%nאפשר לתקן את מה שעצר אותה ולהריץ אותה שוב.
he.AbortRetryIgnoreSelectAction=מה לעשות?
he.RetryCancelSelectAction=מה לעשות?
he.FileExistsSelectAction=מה לעשות?
he.SetupFileMissing=הקובץ %1 חסר בהתקנה. כדאי להוריד אותה שוב.
he.SetupFileCorrupt=קבצי ההתקנה פגומים. כדאי להוריד אותה שוב.
he.SetupFileCorruptOrWrongVer=קבצי ההתקנה פגומים, או שאינם של הגרסה הזו. כדאי להוריד אותה שוב.
he.DiskSpaceWarning=צריך לפחות %1KB פנויים, ובכונן יש רק %2KB. להמשיך בכל זאת?
en.SetupAppTitle=Pip Setup
en.SetupWindowTitle=Pip Setup
en.WelcomeLabel1=Hi, I'm Pip!
en.WelcomeLabel2=I'll install myself on this computer: the program, and whatever it needs that isn't here yet. It takes a few minutes, and then we carry on in the browser.
en.SelectTasksLabel2=Pick anything else to add, then Install.
en.InstallingLabel=Hold on, I'm installing myself on this computer.
en.FinishedHeadingLabel=Pip is on this computer!
en.FinishedLabel=Pip is installed on this computer, and starts from the Pip shortcut.
en.ConfirmUninstall=Remove Pip from this computer? The user folder, with everything kept in it, stays.

[CustomMessages]
he.Desktop=קיצור דרך על שולחן העבודה
he.Startup=להפעיל את פיפ כשהמחשב נדלק, בשביל החיפושים היומיים
he.StepBun=מוריד את Bun, שפיפ רץ עליו...
he.StepPython=בודק שיש Python, ומתקין אם אין...
he.StepLatex=בודק שיש MiKTeX בשביל קורות החיים, ומתקין אם אין. זה יכול לקחת כמה דקות...
he.StepPackages=מתקין את החבילות של פיפ...
he.StepWarmup=מכין את קורות החיים הראשונים, כדי ש-LaTeX יוריד כבר עכשיו כל מה שהם צריכים. זה יכול לקחת כמה דקות...
he.StepFailed=לא הצלחתי: %1%n%nכדאי לבדוק את החיבור לאינטרנט ולהריץ את ההתקנה שוב: היא תמשיך מאיפה שנעצרה. מה קרה כתוב ב-%2
he.Launch=להפעיל את פיפ עכשיו
en.Desktop=A shortcut on the desktop
en.Startup=Start Pip when the computer starts, for the daily searches
en.StepBun=Downloading Bun, which Pip runs on...
en.StepPython=Checking for Python, and installing it if it isn't here...
en.StepLatex=Checking for MiKTeX, for the CVs, and installing it if it isn't here. This can take a few minutes...
en.StepPackages=Installing Pip's packages...
en.StepWarmup=Making a first CV, so that LaTeX downloads everything CVs need now. This can take a few minutes...
en.StepFailed=This didn't work: %1%n%nCheck the internet connection and run the installer again: it carries on from where it stopped. What happened is written in %2
en.Launch=Start Pip now

[Tasks]
Name: "desktopicon"; Description: "{cm:Desktop}"
Name: "startup"; Description: "{cm:Startup}"

[Files]
Source: "stage\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "stage\Pip.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#AppName}"; Filename: "{app}\Pip.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\Pip.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}"; Filename: "{app}\Pip.exe"; Parameters: "--background"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\Pip.exe"; Description: "{cm:Launch}"; Flags: postinstall nowait skipifsilent
; An update: Pip back in the background, with no page opened; one open already carries on by itself. postinstall, which
; an unseen setup runs too, so that it starts after the steps ([Code]), on the packages as they are now.
Filename: "{app}\Pip.exe"; Parameters: "--background"; Flags: postinstall nowait; Check: IsUpdate

[UninstallRun]
Filename: "{app}\Pip.exe"; Parameters: "--stop"; Flags: waituntilterminated; RunOnceId: "StopPip"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\web\public\build"
Type: files; Name: "{app}\install.log"

[Code]
// What the steps after the files are in bring in, each version out at least two weeks before it was picked, with
// the checksum each download must have: Bun's from its release, Python's the file signed by the Python Software
// Foundation, MiKTeX's (it isn't signed) as miktex.org gives it.
const
  BunUrl = 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-windows-x64.zip';
  BunSha256 = 'cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5';
  PythonUrl = 'https://www.python.org/ftp/python/3.14.9/python-3.14.9-amd64.exe';
  PythonSha256 = 'a247a0b612244a803f507b39fb7121e3602e4160d59c3b99d98e735289c53394';
  MiktexUrl = 'https://miktex.org/download/ctan/systems/win32/miktex/setup/windows-x64/basic-miktex-25.12-x64.exe';
  MiktexSha256 = '14b42dd9f4b4a7813a8bfd69c8f99316c2888cc4ee26f631f397e163d85d6c62';
  PythonPackages = 'pypdf==6.21.2 pymupdf==1.28.2 pyyaml==6.0.3 openpyxl==3.1.5';

function SetEnvironmentVariable(lpName, lpValue: String): BOOL;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';
function ExpandEnvironmentStrings(lpSrc, lpDst: String; nSize: DWORD): DWORD;
  external 'ExpandEnvironmentStringsW@kernel32.dll stdcall';

// Run by Pip itself to update (launcher.cs): no wizard, and only what an update needs.
function IsUpdate: Boolean;
begin
  Result := ExpandConstant('{param:update|0}') = '1';
end;

// What each step does goes in install.log, beside the program.
procedure Note(const Text: String);
begin
  Log(Text);
  SaveStringToFile(ExpandConstant('{app}\install.log'), GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + ' ' + Text + #13#10, True);
end;

// PATH as the system and the user have it now, with what an installer has just added, which this setup's own, from
// when it started, doesn't have; made this setup's, so the programs it runs find what they need too, the program's
// Bun first.
function RefreshPath: String;
var
  Machine, User, Expanded: String;
  Size: DWORD;
begin
  if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', Machine) then Machine := '';
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', User) then User := '';
  Result := ExpandConstant('{app}\runtime\bun') + ';' + Machine + ';' + User;
  SetLength(Expanded, 32767);
  Size := ExpandEnvironmentStrings(Result, Expanded, 32767);
  if Size > 0 then Result := Copy(Expanded, 1, Size - 1);
  SetEnvironmentVariable('PATH', Result);
end;

// A program run to its end, unseen: whether it ran and ended well.
function RunProgram(const Exe, Params, Dir: String): Boolean;
var
  Code: Integer;
begin
  Result := Exec(Exe, Params, Dir, SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then Note('  ' + ExtractFileName(Exe) + ' ' + Params + ': stopped with ' + IntToStr(Code));
end;

// Python 3.10 or later, as py or python on PATH: its path, or nothing if there is none.
function FindPython: String;
var
  Path, Found: String;
begin
  Result := '';
  Path := RefreshPath;
  Found := FileSearch('py.exe', Path);
  if (Found <> '') and RunProgram(Found, '-c "import sys; sys.exit(sys.version_info < (3, 10))"', '') then
  begin
    Result := Found;
    Exit;
  end;
  Found := FileSearch('python.exe', Path);
  if (Found <> '') and RunProgram(Found, '-c "import sys; sys.exit(sys.version_info < (3, 10))"', '') then Result := Found;
end;

// How much of a download is in, in megabytes, under the step's words.
function OnDownload(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  if ProgressMax > 0 then
    WizardForm.FilenameLabel.Caption := IntToStr(Integer(Progress div 1048576)) + ' / ' + IntToStr(Integer(ProgressMax div 1048576)) + ' MB';
  Result := True;
end;

// Downloaded into the setup's own temporary folder, which goes when it ends, and refused unless it is the very file
// expected.
function Download(const Url, Name, Sha256: String): Boolean;
begin
  Note('  downloading ' + Url);
  try
    DownloadTemporaryFile(Url, Name, Sha256, @OnDownload);
    Result := True;
  except
    Note('  ' + GetExceptionMessage);
    Result := False;
  end;
  WizardForm.FilenameLabel.Caption := '';
end;

function StepBun: Boolean;
var
  Bun: String;
begin
  Bun := ExpandConstant('{app}\runtime\bun\bun.exe');
  Result := FileExists(Bun);
  if Result then Exit;
  Result := Download(BunUrl, 'bun-windows-x64.zip', BunSha256);
  if Result then Result := RunProgram(ExpandConstant('{sys}\tar.exe'), '-xf "' + ExpandConstant('{tmp}\bun-windows-x64.zip') + '" -C "' + ExpandConstant('{tmp}') + '"', '');
  if Result then Result := ForceDirectories(ExtractFileDir(Bun)) and FileCopy(ExpandConstant('{tmp}\bun-windows-x64\bun.exe'), Bun, False);
end;

function StepPython: Boolean;
begin
  Result := FindPython <> '';
  if Result then Exit;
  Result := Download(PythonUrl, 'python-setup.exe', PythonSha256);
  if Result then Result := RunProgram(ExpandConstant('{tmp}\python-setup.exe'), '/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1 InstallLauncherAllUsers=0', '');
  if Result then Result := FindPython <> '';
end;

// With MiKTeX, new or already there, a package a document lacks comes in by itself, rather than a window waiting for
// an answer nobody sees: the warm-up (StepWarmup) needs that, and so does a CV later.
function StepLatex: Boolean;
var
  Initexmf: String;
begin
  Result := FileSearch('lualatex.exe', RefreshPath) <> '';
  if not Result then
  begin
    Result := Download(MiktexUrl, 'miktex-setup.exe', MiktexSha256);
    if Result then Result := RunProgram(ExpandConstant('{tmp}\miktex-setup.exe'), '--unattended --private --auto-install=yes', '');
    if Result then Result := FileSearch('lualatex.exe', RefreshPath) <> '';
  end;
  Initexmf := FileSearch('initexmf.exe', RefreshPath);
  if Result and (Initexmf <> '') then RunProgram(Initexmf, '--set-config-value=[MPM]AutoInstall=1', '');
end;

// The program's packages and the job portals', at the versions locked in the files; and Python's for its tools:
// pypdf to read PDFs, PyMuPDF to see their pages, PyYAML for the skills' files, openpyxl for salary tables.
function StepPackages: Boolean;
var
  Python: String;
begin
  RefreshPath;
  Result := RunProgram(ExpandConstant('{app}\runtime\bun\bun.exe'), 'install --ignore-scripts', ExpandConstant('{app}\web'));
  if not Result then Exit;
  Python := FindPython;
  Result := Python <> '';
  if Result then Result := RunProgram(Python, 'tools\install_portal_clis.py', ExpandConstant('{app}'));
  if Result then Result := RunProgram(Python, '-m pip install --user --disable-pip-version-check --quiet ' + PythonPackages, '');
end;

// A step with its words on the installing page while it runs, logged; one that fails says so, with where the log
// is, and the steps after it don't run.
function Outcome(const Name: String; const Ok: Boolean): Boolean;
begin
  Result := Ok;
  if Result then
    Note(Name + ': done')
  else
  begin
    Note(Name + ': FAILED');
    SuppressibleMsgBox(FmtMessage(CustomMessage('StepFailed'), [CustomMessage(Name), ExpandConstant('{app}\install.log')]), mbError, MB_OK, IDOK);
  end;
end;

function Showing(const Name: String): Boolean;
begin
  WizardForm.StatusLabel.Caption := CustomMessage(Name);
  WizardForm.FilenameLabel.Caption := '';
  Note(Name + '...');
  Result := True;
end;

// A folder and all in it, through rd with the long-path prefix: packages nest deeper than the usual limit on the
// length of a path, which the uninstaller's own deleting stops at.
procedure RemoveTree(const Path: String);
var
  Code: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/c rd /s /q "\\?\' + Path + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

// What the program made beside its own files as it ran, packages bun put in and Python's caches, anywhere but the
// user's folder: they go with it on removal, and then any folder left empty. A folder with anything else in it
// stays.
procedure DeleteMade(const Dir: String);
var
  Found: TFindRec;
  Path: String;
begin
  if FindFirst(Dir + '\*', Found) then
  try
    repeat
      Path := Dir + '\' + Found.Name;
      if (Found.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and (Found.Name <> '.') and (Found.Name <> '..') then
      begin
        if (Found.Name = 'node_modules') or (Found.Name = '__pycache__') then
          RemoveTree(Path)
        else if CompareText(Path, ExpandConstant('{app}\user')) <> 0 then
        begin
          DeleteMade(Path);
          RemoveDir(Path);
        end;
      end;
    until not FindNext(Found);
  finally
    FindClose(Found);
  end;
end;

// LaTeX's packages for the CVs and letters, all brought in now rather than at the first CV: the templates' own
// examples built once in a folder of the program's (warmup\cv, as deep as user\cv, which the one-page template's path
// to its style counts on), the packages each lacks coming in as it goes, and lualatex's list of fonts made. The
// moderncv CV and the cover letter must come out. The one-page template, made to be filled in by build.py first, is
// built as far as it goes: past its preamble, where all its packages are, is all it is here for.
function StepWarmup: Boolean;
var
  Path, Lualatex, Xelatex, Dir: String;
begin
  Path := RefreshPath;
  Lualatex := FileSearch('lualatex.exe', Path);
  Xelatex := FileSearch('xelatex.exe', Path);
  Dir := ExpandConstant('{app}\warmup\cv');
  Result := (Lualatex <> '') and (Xelatex <> '') and ForceDirectories(Dir);
  if Result then Result := FileCopy(ExpandConstant('{app}\templates\user\cv\main_example.tex'), Dir + '\main_example.tex', False);
  if Result then Result := RunProgram(Lualatex, '-interaction=nonstopmode -halt-on-error main_example.tex', Dir);
  if Result then Result := RunProgram(Xelatex, '-interaction=nonstopmode -halt-on-error -output-directory="' + Dir + '" cover_example.tex', ExpandConstant('{app}\cover_letters'));
  if Result and FileCopy(ExpandConstant('{app}\templates\cv\one-page-clean\template.tex'), Dir + '\template.tex', False) then
    if not RunProgram(Lualatex, '-interaction=nonstopmode template.tex', Dir) then Note('  (the one-page template stops at its placeholders, as expected)');
  RemoveTree(ExpandConstant('{app}\warmup'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DeleteMade(ExpandConstant('{app}'));
    RemoveDir(ExpandConstant('{app}'));
  end;
end;

// A Pip already running here stops before its files are replaced; once they are in, the steps run in turn, the
// progress bar going all along, since how long each takes can't be known. An update leaves out LaTeX's warm-up: the
// packages are in from the first install, and MiKTeX fetches any a new template lacks by itself.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssInstall) and FileExists(ExpandConstant('{app}\Pip.exe')) then
    RunProgram(ExpandConstant('{app}\Pip.exe'), '--stop', '');
  if CurStep = ssPostInstall then
  begin
    WizardForm.ProgressGauge.Style := npbstMarquee;
    try
      if Showing('StepBun') and Outcome('StepBun', StepBun) then
        if Showing('StepPython') and Outcome('StepPython', StepPython) then
          if Showing('StepLatex') and Outcome('StepLatex', StepLatex) then
            if Showing('StepPackages') and Outcome('StepPackages', StepPackages) then
              if not IsUpdate and Showing('StepWarmup') then Outcome('StepWarmup', StepWarmup);
    finally
      WizardForm.ProgressGauge.Style := npbstNormal;
    end;
  end;
end;
