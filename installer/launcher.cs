// Pip.exe, what Pip's shortcuts open (pip.iss): a program with no window of its own. Unless the program's server is
// on already, it starts it on the Bun the installer brought in, unseen, with PATH as the system and the user have it
// now (Python's and MiKTeX's installers add to it), and stays with it, keeping what it writes in logs\server.log,
// with Pip's icon by the clock for as long as it runs: open Pip from it (a double click does too), or quit, which
// stops the server. A server that stops to open another account (RESTART) is started again. Opening Pip asks the server where, with the key it keeps (user\app\token), the only way in from a
// browser (/open in web/server.ts): straight on Pip's site (Site), which the server joins as soon as it starts, or on
// this computer while the site is out of reach. With a page of Pip open in the browser already, its window comes to
// the front instead of a second page opening, its tab picked first when another tab is in front of it, and if no
// window has Pip, it opens anyway. The first start takes longer: the server builds the interface before it is up.
// The icon's words are Hebrew with a Hebrew Windows, and English otherwise.
// While the server runs, it keeps Pip as new as its site (Update): when the site has another version, it runs the
// site's installer unseen, which puts it in and starts Pip again.
//   --background  the server alone, no browser (the shortcut that starts with Windows, for the daily searches, and
//                 the installer once it has updated Pip)
//   --stop        stops the server (the uninstaller, and an install over this one)
// The port is the server's own: JOB_WEB_PORT, or 4174; the site is PIP_SITE if set, or Site. Built by build.ts with
// the C# compiler Windows comes with.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

[assembly: AssemblyTitle("Pip")]
[assembly: AssemblyDescription("Starts Pip, the job search companion")]
[assembly: AssemblyProduct("Pip")]
[assembly: AssemblyCompany("Pip")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Launcher
{
    // Where Pip is used, from this computer too (web/remote.ts, site/server.ts).
    const string Site = "https://pip-site-production-8fff.up.railway.app";
    // How long a first start may take to be up: the server builds the interface first.
    const int UP_WITHIN_MS = 90000;
    // A browser window on a page of Pip: the page's title (app.tsx), "פיפ / ..." or "Pip / ...", waiting conversations
    // counted before it.
    static readonly Regex PipTitle = new Regex(@"^(\(\d+\) )?(פיפ|Pip) / ");
    // The browsers whose tabs Pip can pick when its own is behind another (PickPipTab): Chrome's kind, and Firefox.
    static readonly string[] Browsers = { "brave", "chrome", "msedge", "vivaldi", "opera", "chromium", "firefox" };
    // Updates (Update): how soon after the server starts and how often the site is asked for its version
    // (PIP_UPDATE_EVERY_MS sets the second, to try it); how long a version tried and not taken waits to be tried again;
    // how long the page has, once told Pip is updating, to ask (it does every few seconds) before Pip goes; and how soon
    // after starting a server that stops by itself counts as one that wouldn't start.
    const int UPDATE_FIRST_MS = 60000;
    const int UPDATE_EVERY_MS = 180000;
    const long UPDATE_RETRY_MS = 6L * 60 * 60 * 1000;
    const int UPDATE_TELL_MS = 8000;
    const int STARTED_MS = 60000;
    // What the server stops with to open another account (web/server.ts restart): it is started again.
    const int RESTART = 75;
    static int updating;

    static int Main(string[] args)
    {
        string app = AppDomain.CurrentDomain.BaseDirectory;
        string bun = Path.Combine(app, @"runtime\bun\bun.exe");
        string data = Path.Combine(app, @"user\app");
        string port = Environment.GetEnvironmentVariable("JOB_WEB_PORT");
        if (string.IsNullOrEmpty(port)) port = "4174";
        string site = Environment.GetEnvironmentVariable("PIP_SITE");
        if (string.IsNullOrEmpty(site)) site = Site;
        bool background = Array.IndexOf(args, "--background") >= 0;
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;

        if (Array.IndexOf(args, "--stop") >= 0)
        {
            foreach (Process running in Process.GetProcessesByName("bun"))
            {
                try
                {
                    if (string.Equals(running.MainModule.FileName, bun, StringComparison.OrdinalIgnoreCase)) running.Kill();
                }
                catch (Exception) { }
            }
            return 0;
        }
        if (Answers(int.Parse(port)))
        {
            if (!background) Open(port, data, true);
            return 0;
        }

        Directory.CreateDirectory(data);
        // The server's log beside Pip, not in user\: opening another account moves user\ aside (web/accounts.ts), which
        // Windows refuses while a file in it is open.
        string logs = Path.Combine(app, "logs");
        Directory.CreateDirectory(logs);
        ProcessStartInfo start = new ProcessStartInfo(bun, "run server.ts");
        start.WorkingDirectory = Path.Combine(app, "web");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.EnvironmentVariables["PATH"] = Path.GetDirectoryName(bun) + ";"
            + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) + ";"
            + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User);
        start.EnvironmentVariables["PIP_SITE"] = site;
        // This opens the browser, once the server is up, so that a page open already comes up rather than a second.
        start.EnvironmentVariables["JOB_WEB_NO_BROWSER"] = "1";
        // So the server stops with RESTART to open another account, rather than start its own new one.
        start.EnvironmentVariables["PIP_LAUNCHER"] = "1";
        using (StreamWriter log = new StreamWriter(Path.Combine(logs, "server.log"), false))
        {
            log.AutoFlush = true;
            DataReceivedEventHandler keep = delegate (object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) lock (log) log.WriteLine(e.Data);
            };
            Stopwatch running = Stopwatch.StartNew();
            bool quitting = false;
            Process server = Launch(start, keep);
            Updates(site, port, app, data, () => server);
            if (!background)
            {
                ThreadPool.QueueUserWorkItem(delegate
                {
                    for (Stopwatch since = Stopwatch.StartNew(); since.ElapsedMilliseconds < UP_WITHIN_MS && !server.HasExited; Thread.Sleep(300))
                    {
                        if (Answers(int.Parse(port))) { Open(port, data, false); return; }
                    }
                });
            }

            bool hebrew = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "he";
            SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
            SynchronizationContext ui = SynchronizationContext.Current;
            using (NotifyIcon tray = new NotifyIcon())
            {
                EventHandler open = delegate { Open(port, data, true); };
                ContextMenu menu = new ContextMenu(new MenuItem[]
                {
                    new MenuItem(hebrew ? "פתיחת פיפ" : "Open Pip", open),
                    new MenuItem(hebrew ? "יציאה" : "Quit", delegate { quitting = true; try { server.Kill(); } catch (Exception) { } }),
                });
                if (hebrew) menu.RightToLeft = RightToLeft.Yes;
                // The icon's small picture, drawn for the size by the clock, rather than the big one shrunk to it.
                IntPtr[] small = new IntPtr[1];
                tray.Icon = ExtractIconEx(Application.ExecutablePath, 0, null, small, 1) > 0 && small[0] != IntPtr.Zero
                    ? Icon.FromHandle(small[0]) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                tray.Text = hebrew ? "פיפ פועל" : "Pip is running";
                tray.ContextMenu = menu;
                tray.DoubleClick += open;
                tray.Visible = true;
                // The server stopping, by Quit or from outside, ends this with it, and the icon goes; one that stops to
                // open another account is started again, and the icon stays.
                EventHandler exited = null;
                exited = delegate
                {
                    ui.Post(delegate
                    {
                        if (!quitting && server.ExitCode == RESTART)
                        {
                            server = Launch(start, keep);
                            server.Exited += exited;
                            running.Restart();
                            return;
                        }
                        Application.ExitThread();
                    }, null);
                };
                server.Exited += exited;
                if (!server.HasExited) Application.Run();
                tray.Visible = false;
            }
            server.WaitForExit();
            // A server that stopped by itself soon after it started may be one an update broke: the site may have the
            // one that mends it already.
            if (!quitting && server.ExitCode != 0 && running.ElapsedMilliseconds < STARTED_MS)
            {
                try { Update(site, port, app, data); } catch (Exception) { }
            }
            return server.ExitCode;
        }
    }

    // The server, its output kept in the log as it comes.
    static Process Launch(ProcessStartInfo start, DataReceivedEventHandler keep)
    {
        Process server = new Process();
        server.StartInfo = start;
        server.OutputDataReceived += keep;
        server.ErrorDataReceived += keep;
        server.EnableRaisingEvents = true;
        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
        return server;
    }

    // While the server runs, a look at the site a minute after it starts and then every few minutes (Update), on a
    // thread of its own, until one starts an update. server is the one running now, which another account opening
    // replaces.
    static void Updates(string site, string port, string app, string data, Func<Process> server)
    {
        int every;
        if (!int.TryParse(Environment.GetEnvironmentVariable("PIP_UPDATE_EVERY_MS"), out every) || every <= 0) every = UPDATE_EVERY_MS;
        Thread checking = new Thread(delegate ()
        {
            Thread.Sleep(Math.Min(UPDATE_FIRST_MS, every));
            while (!server().HasExited || server().ExitCode == RESTART)
            {
                try
                {
                    if (Update(site, port, app, data)) return;
                }
                catch (Exception) { }
                Thread.Sleep(every);
            }
        });
        checking.IsBackground = true;
        checking.Start();
    }

    // One look: when the site's version for Windows (version.json, deploy.ts) isn't the one installed here
    // (VERSION.json, build.ts) and Pip isn't in the middle of something, the site's installer, checked against the
    // SHA-256 the site gives for it, runs unseen (/UPDATE=1 in pip.iss): it stops Pip, puts the new one in, and starts it
    // again in the background. Before it goes, the server is told, so that the page says Pip is updating. True once the
    // installer runs. A version tried already is tried again only after a while; a server that doesn't answer isn't in
    // the middle of anything, so an update can mend one that broke.
    static bool Update(string site, string port, string app, string data)
    {
        if (Interlocked.Exchange(ref updating, 1) == 1) return false;
        try
        {
            string mine = Field(ReadOrEmpty(Path.Combine(app, "VERSION.json")), "windows");
            if (mine == "") return false;
            string offered;
            using (WebClient web = new WebClient())
            {
                web.Encoding = Encoding.UTF8;
                offered = web.DownloadString(site + "/version.json");
            }
            string version = Field(offered, "windows");
            string sha = Field(offered, "setup");
            if (version == "" || sha == "" || version == mine) return false;
            string tried = Path.Combine(data, "update.json");
            string last = ReadOrEmpty(tried);
            long at;
            if (Field(last, "version") == version && long.TryParse(Field(last, "at"), out at) && Now() - at < UPDATE_RETRY_MS) return false;
            string token = ReadOrEmpty(Path.Combine(data, "token")).Trim();
            if (AskServer(port, token, "GET").Contains("\"busy\":true")) return false;
            string setup = Path.Combine(Path.GetTempPath(), "PipUpdate", "PipSetup.exe");
            Directory.CreateDirectory(Path.GetDirectoryName(setup));
            using (WebClient web = new WebClient()) web.DownloadFile(site + "/PipSetup.exe", setup);
            if (!string.Equals(Sha256Of(setup), sha, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(setup);
                return false;
            }
            File.WriteAllText(tried, "{\"version\":\"" + version + "\",\"at\":\"" + Now() + "\"}");
            if (AskServer(port, token, "POST") != "") Thread.Sleep(UPDATE_TELL_MS);
            ProcessStartInfo run = new ProcessStartInfo(setup, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE=1 /LOG=\"" + Path.Combine(data, "update.log") + "\"");
            run.UseShellExecute = false;
            run.WorkingDirectory = Path.GetDirectoryName(setup);
            Process.Start(run);
            return true;
        }
        finally
        {
            Interlocked.Exchange(ref updating, 0);
        }
    }

    // The server's answer about updates (/update in web/server.ts): whether it is busy, or, posted, that Pip is about
    // to update; "" when it doesn't answer.
    static string AskServer(string port, string token, string method)
    {
        try
        {
            HttpWebRequest ask = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/update?t=" + token);
            ask.Method = method;
            ask.Proxy = null;
            ask.Timeout = 5000;
            if (method == "POST") ask.ContentLength = 0;
            using (WebResponse answer = ask.GetResponse())
            using (StreamReader body = new StreamReader(answer.GetResponseStream(), Encoding.UTF8))
            {
                return body.ReadToEnd();
            }
        }
        catch (Exception)
        {
            return "";
        }
    }

    // A string's value in a JSON object written flat, as version.json and VERSION.json are, or "".
    static string Field(string json, string name)
    {
        Match found = Regex.Match(json ?? "", "\"" + name + "\"\\s*:\\s*\"([^\"]*)\"");
        return found.Success ? found.Groups[1].Value : "";
    }

    static string ReadOrEmpty(string file)
    {
        try { return File.ReadAllText(file); } catch (Exception) { return ""; }
    }

    static string Sha256Of(string file)
    {
        using (SHA256 sha = SHA256.Create())
        using (FileStream stream = File.OpenRead(file))
        {
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
    }

    static long Now()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // Opens Pip where the server says, or, with a page of it open already, brings up that page's window. Asked for
    // (clicked), it opens anyway when no window shows Pip, so a click always shows it; on its own after the server
    // starts, it leaves a page open already be, which comes back by itself from its offline screen. A server that
    // doesn't answer so gets the browser on its start link.
    static void Open(string port, string data, bool clicked)
    {
        string file = Path.Combine(data, "token");
        if (!File.Exists(file)) return;
        string start = "http://127.0.0.1:" + port + "/";
        string token = File.ReadAllText(file).Trim();
        string to = start + "?t=" + token;
        try
        {
            HttpWebRequest ask = (HttpWebRequest)WebRequest.Create(start + "open?t=" + token);
            ask.Proxy = null;
            ask.Timeout = 10000;
            using (HttpWebResponse answer = (HttpWebResponse)ask.GetResponse())
            using (StreamReader body = new StreamReader(answer.GetResponseStream(), Encoding.UTF8))
            {
                string plan = body.ReadToEnd();
                Match url = Regex.Match(plan, "\"url\":\"([^\"]+)\"");
                if (url.Success) to = url.Groups[1].Value;
                if (plan.Contains("\"already\":true") && (BringUp() || !clicked)) return;
            }
        }
        catch (Exception) { }
        Process.Start(to);
    }

    // The browser window with a page of Pip to the front, restored if it was minimized, and Pip's tab picked first if
    // another is in front of it; false if no window has one.
    static bool BringUp()
    {
        IntPtr found = FindPip();
        if (found == IntPtr.Zero) found = PickPipTab();
        if (found == IntPtr.Zero) return false;
        if (IsIconic(found)) ShowWindow(found, SW_RESTORE);
        return SetForegroundWindow(found);
    }

    // The first window whose title is a page of Pip's, or none.
    static IntPtr FindPip()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr window, IntPtr unused)
        {
            if (!IsWindowVisible(window)) return true;
            StringBuilder title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            if (!IsPip(title.ToString())) return true;
            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    // A title of a page of Pip's, without the marks of direction a browser may put round a right-to-left one.
    static bool IsPip(string title)
    {
        return PipTitle.IsMatch(Regex.Replace(title, "[‎‏‪-‮⁦-⁩]", ""));
    }

    // A browser window with a tab of Pip behind another, that tab picked, or none: a window's title shows only the tab
    // in front.
    static IntPtr PickPipTab()
    {
        foreach (IntPtr window in BrowserWindows())
        {
            try
            {
                if (PickIn(window)) return window;
            }
            catch (Exception) { }
        }
        return IntPtr.Zero;
    }

    // The browsers' windows, frontmost first, but those minimized, whose tabs aren't shown to be picked.
    static List<IntPtr> BrowserWindows()
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate (IntPtr window, IntPtr unused)
        {
            string kind = ClassOf(window);
            if (!IsWindowVisible(window) || IsIconic(window) || (kind != "Chrome_WidgetWin_1" && kind != "MozillaWindowClass")) return true;
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            try
            {
                using (Process browser = Process.GetProcessById((int)owner))
                {
                    if (Array.IndexOf(Browsers, browser.ProcessName.ToLowerInvariant()) >= 0) found.Add(window);
                }
            }
            catch (Exception) { }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // Picks the tab of a page of Pip in a browser window, if it has one, as a screen reader would (UI Automation): by
    // its title, in the browser's frame, never in the pages themselves. Firefox shows its tabs so only a moment after
    // it is first asked, so a window of its with no tabs shown yet is asked again.
    static bool PickIn(IntPtr window)
    {
        for (int tries = ClassOf(window) == "MozillaWindowClass" ? 3 : 1; tries > 0; tries--)
        {
            bool tabs = false;
            TreeWalker walk = TreeWalker.ControlViewWalker;
            Stack<AutomationElement> left = new Stack<AutomationElement>();
            left.Push(AutomationElement.FromHandle(window));
            while (left.Count > 0)
            {
                for (AutomationElement child = walk.GetFirstChild(left.Pop()); child != null; child = walk.GetNextSibling(child))
                {
                    ControlType type = child.Current.ControlType;
                    if (type == ControlType.TabItem)
                    {
                        tabs = true;
                        if (!IsPip(child.Current.Name)) continue;
                        ((SelectionItemPattern)child.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
                        return true;
                    }
                    if (type != ControlType.Document) left.Push(child);
                }
            }
            if (tabs) return false;
            if (tries > 1) Thread.Sleep(1000);
        }
        return false;
    }

    static string ClassOf(IntPtr window)
    {
        StringBuilder kind = new StringBuilder(64);
        GetClassName(window, kind, kind.Capacity);
        return kind.ToString();
    }

    const int SW_RESTORE = 9;
    delegate bool EnumWindowsProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc each, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int show);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);

    // Whether anything takes a connection on the port: that is the server, as nothing else is meant to be there.
    static bool Answers(int port)
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult tried = client.BeginConnect("127.0.0.1", port, null, null);
                if (!tried.AsyncWaitHandle.WaitOne(1000)) return false;
                client.EndConnect(tried);
                return true;
            }
        }
        catch (Exception)
        {
            return false;
        }
    }
}
