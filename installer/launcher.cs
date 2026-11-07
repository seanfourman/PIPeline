// Pip.exe, what Pip's shortcuts open (pip.iss): a program with no window of its own. Unless the program's server is
// on already, it starts it on the Bun the installer brought in, unseen, with PATH as the system and the user have it
// now (Python's and MiKTeX's installers add to it), and stays with it, keeping what it writes in user\app\server.log,
// with Pip's icon by the clock for as long as it runs: open Pip from it (a double click does too), or quit, which
// stops the server. Opening Pip asks the server where, with the key it keeps (user\app\token), the only way in from a
// browser (/open in web/server.ts): straight on Pip's site (Site), which the server joins as soon as it starts, or on
// this computer while the site is out of reach. With a page of Pip open in the browser already, its window comes to
// the front instead of a second page opening, and if no window shows Pip, it opens anyway. The first start takes
// longer: the server builds the interface before it is up. The icon's words are Hebrew with a Hebrew Windows, and
// English otherwise.
//   --background  the server alone, no browser (the shortcut that starts with Windows, for the daily searches)
//   --stop        stops the server (the uninstaller, and an install over this one)
// The port is the server's own: JOB_WEB_PORT, or 4174. Built by build.ts with the C# compiler Windows comes with.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
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

    static int Main(string[] args)
    {
        string app = AppDomain.CurrentDomain.BaseDirectory;
        string bun = Path.Combine(app, @"runtime\bun\bun.exe");
        string data = Path.Combine(app, @"user\app");
        string port = Environment.GetEnvironmentVariable("JOB_WEB_PORT");
        if (string.IsNullOrEmpty(port)) port = "4174";
        bool background = Array.IndexOf(args, "--background") >= 0;

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
        ProcessStartInfo start = new ProcessStartInfo(bun, "run server.ts");
        start.WorkingDirectory = Path.Combine(app, "web");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.EnvironmentVariables["PATH"] = Path.GetDirectoryName(bun) + ";"
            + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) + ";"
            + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User);
        start.EnvironmentVariables["PIP_SITE"] = Site;
        // This opens the browser, once the server is up, so that a page open already comes up rather than a second.
        start.EnvironmentVariables["JOB_WEB_NO_BROWSER"] = "1";
        using (StreamWriter log = new StreamWriter(Path.Combine(data, "server.log"), false))
        {
            log.AutoFlush = true;
            Process server = new Process();
            server.StartInfo = start;
            DataReceivedEventHandler keep = delegate (object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) lock (log) log.WriteLine(e.Data);
            };
            server.OutputDataReceived += keep;
            server.ErrorDataReceived += keep;
            server.EnableRaisingEvents = true;
            server.Start();
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
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
                    new MenuItem(hebrew ? "יציאה" : "Quit", delegate { try { server.Kill(); } catch (Exception) { } }),
                });
                if (hebrew) menu.RightToLeft = RightToLeft.Yes;
                tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                tray.Text = hebrew ? "פיפ פועל" : "Pip is running";
                tray.ContextMenu = menu;
                tray.DoubleClick += open;
                tray.Visible = true;
                // The server stopping, by Quit or from outside, ends this with it, and the icon goes.
                server.Exited += delegate { ui.Post(delegate { Application.ExitThread(); }, null); };
                if (!server.HasExited) Application.Run();
                tray.Visible = false;
            }
            server.WaitForExit();
            return server.ExitCode;
        }
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

    // The browser window showing a page of Pip to the front, restored if it was minimized; false if none shows one.
    static bool BringUp()
    {
        IntPtr found = FindPip();
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
            // Without the marks of direction a browser may put round a right-to-left title.
            if (!PipTitle.IsMatch(Regex.Replace(title.ToString(), "[‎‏‪-‮⁦-⁩]", ""))) return true;
            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    const int SW_RESTORE = 9;
    delegate bool EnumWindowsProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc each, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int show);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);

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
