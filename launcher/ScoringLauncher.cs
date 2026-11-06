using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // A separate test root exercises the real launcher without touching match data.
        string root = AppDomain.CurrentDomain.BaseDirectory;
        bool test = args.Length == 3 && args[0] == "--self-test";
        int port = 3000;
        if (test) { root = Path.GetFullPath(args[1]); port = int.Parse(args[2]); }
        bool created;
        using (var singleton = new Mutex(true, "Local\\ScoringSystemLauncher", out created))
        {
            if (!created)
            {
                MessageBox.Show("启动器已经打开，请切换到“评分服务”窗口。", "评分服务");
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Launcher(root, port, test));
        }
    }
}

internal sealed class AddressEntry
{
    public string Url;
    public string Label;
    public override string ToString() { return Label; }
}

internal sealed class Launcher : Form
{
    readonly string BaseUrl;
    readonly int port;
    readonly bool testing;
    readonly string root;
    readonly HttpClient http = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(2) };
    readonly Label status = new Label();
    readonly ComboBox addresses = new ComboBox();
    readonly TextBox details = new TextBox();
    readonly Button start = new Button();
    readonly Button stop = new Button();
    readonly System.Windows.Forms.Timer monitor = new System.Windows.Forms.Timer();
    Process owned;
    bool busy;
    bool ready;

    [DllImport("kernel32.dll")]
    static extern uint SetThreadExecutionState(uint flags);

    public Launcher(string directory, int servicePort, bool selfTest)
    {
        root = directory;
        port = servicePort;
        testing = selfTest;
        BaseUrl = "http://localhost:" + port;
        Text = "评分服务 · 一键启动";
        Font = new Font("Microsoft YaHei UI", 10F);
        ClientSize = new Size(780, 510);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(245, 247, 250);
        AutoScaleMode = AutoScaleMode.Dpi;

        var heading = new Label { Text = "现场评分服务", Font = new Font(Font.FontFamily, 21F, FontStyle.Bold), AutoSize = true, Location = new Point(25, 20) };
        Controls.Add(heading);
        status.SetBounds(28, 75, 720, 28);
        status.Text = "正在检查服务…";
        Controls.Add(status);
        var local = new LinkLabel { Text = "管理后台：" + BaseUrl, AutoSize = true, Location = new Point(28, 115) };
        local.LinkClicked += delegate { Open(BaseUrl); };
        Controls.Add(local);
        Controls.Add(new Label { Text = "评委手机访问地址（选择手机所在的网络）", AutoSize = true, Location = new Point(28, 155) });
        addresses.SetBounds(28, 186, 720, 32);
        addresses.DropDownStyle = ComboBoxStyle.DropDownList;
        Controls.Add(addresses);

        AddButton(start, "启动服务", 28, async delegate { await StartService(); });
        AddButton(stop, "停止服务", 172, delegate { StopService(true); });
        AddButton(new Button(), "打开后台", 316, delegate { Open(BaseUrl); });
        AddButton(new Button(), "复制评委链接", 460, delegate {
            var entry = addresses.SelectedItem as AddressEntry;
            if (entry != null) { Clipboard.SetText(entry.Url); Log("已复制：" + entry.Url); }
        });
        AddButton(new Button(), "刷新地址", 604, delegate { RefreshAddresses(); });
        details.SetBounds(28, 285, 720, 132);
        details.Multiline = true;
        details.ReadOnly = true;
        details.ScrollBars = ScrollBars.Vertical;
        details.BackColor = Color.White;
        Controls.Add(details);
        Controls.Add(new Label {
            Text = "保持电脑接电、窗口打开。运行期间阻止自动休眠，手动休眠和合盖仍可能中断服务。\n手机需与电脑网络互通；地址由网络分配。关闭窗口时可选择保留后台服务。",
            Location = new Point(28, 438), Size = new Size(725, 58), ForeColor = Color.FromArgb(75, 85, 100)
        });
        stop.Enabled = false;
        monitor.Interval = 5000;
        monitor.Tick += async delegate {
            if (busy) return;
            busy = true;
            try { await UpdateStatus(); RefreshAddresses(); }
            catch (Exception ex) { Log(ex.Message); }
            finally { busy = false; }
        };
        Shown += async delegate {
            RefreshAddresses();
            if (testing) await SelfTest();
            else { await StartService(); monitor.Start(); }
        };
        FormClosing += OnClosing;
    }

    void AddButton(Button button, string title, int x, EventHandler handler)
    {
        button.Text = title;
        button.SetBounds(x, 236, 136, 36);
        button.Click += handler;
        Controls.Add(button);
    }

    void Log(string message)
    {
        if (IsDisposed || Disposing) return;
        if (InvokeRequired) { try { BeginInvoke(new Action<string>(Log), message); } catch (InvalidOperationException) { } return; }
        details.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + message + Environment.NewLine);
    }

    async Task<bool> IsScoringService()
    {
        try {
            string expected = File.ReadAllText(Path.Combine(root, "dist", "index.html"));
            string actual = await http.GetStringAsync(BaseUrl + "/");
            if (actual.Trim() != expected.Trim()) return false;
            string api = await http.GetStringAsync(BaseUrl + "/api/scoring-sets");
            return api.Contains("\"message\":\"success\"") && api.Contains("\"data\":");
        } catch { return false; }
    }

    bool PortInUse()
    {
        return IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(x => x.Port == port);
    }

    string FindNode()
    {
        string[] candidates = {
            Path.Combine(root, "runtime", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
        };
        foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            try { string candidate = Path.Combine(directory.Trim('"'), "node.exe"); if (File.Exists(candidate)) return candidate; } catch { }
        }
        throw new FileNotFoundException("找不到 Node.js。请安装 Node.js 22 LTS，或把 node.exe 放到 runtime 文件夹。");
    }

    async Task StartService()
    {
        if (busy) return;
        busy = true;
        start.Enabled = false;
        status.Text = "正在启动…";
        try {
            foreach (string required in new[] { "index.js", "database.js", "dist/index.html", "node_modules/express/package.json", "node_modules/sqlite3/package.json" })
                if (!File.Exists(Path.Combine(root, required))) throw new FileNotFoundException("缺少项目文件：" + required + "。请把启动器放回项目目录，不要单独移动 EXE。");
            if (await IsScoringService()) {
                AttachManagedProcess();
                Log("检测到评分服务已运行，直接使用现有服务，不重复启动。");
                if (owned == null) Log("该服务由其他方式启动，停止按钮不可用；本窗口不会结束不属于它的进程。");
                await UpdateStatus();
                Open(BaseUrl);
                return;
            }
            if (PortInUse()) throw new InvalidOperationException("端口 " + port + " 已被占用，或现有评分服务未就绪。请检查后重试；启动器不会结束未知程序。");
            Directory.CreateDirectory(Path.Combine(root, "logs"));
            string node = FindNode();
            // The shell redirects logs to files so a retained server survives launcher exit.
            string runner = Path.Combine(root, "launcher", "run-server.cmd");
            Directory.CreateDirectory(Path.GetDirectoryName(runner));
            File.WriteAllText(runner, "@echo off\r\n\"%SCORING_NODE%\" index.js >> logs\\server.out.log 2>> logs\\server.err.log\r\n", Encoding.ASCII);
            var info = new ProcessStartInfo(node, "\"" + Path.Combine(root, "index.js") + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true
            };
            // Use cmd redirection, then obtain the exact child PID via a unique marker.
            // Node itself writes its PID before loading the application.
            string pidPath = Path.Combine(root, "logs", "launcher-" + Guid.NewGuid().ToString("N") + ".pid");
            string bootstrap = Path.Combine(root, "launcher", "bootstrap.js");
            if (!File.Exists(bootstrap)) throw new FileNotFoundException("缺少 launcher/bootstrap.js，请保留完整项目目录。");
            info.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
            info.Arguments = "/d /c \"\"" + runner + "\"\"";
            info.EnvironmentVariables["SCORING_NODE"] = node;
            info.EnvironmentVariables["SCORING_PID_FILE"] = pidPath;
            info.EnvironmentVariables["NODE_OPTIONS"] = "--require \"" + bootstrap.Replace('\\', '/') + "\"";
            using (var shell = Process.Start(info)) {
                for (int i = 0; i < 40; i++) {
                    if (File.Exists(pidPath)) {
                        int pid;
                        if (int.TryParse(File.ReadAllText(pidPath), out pid)) {
                            owned = Process.GetProcessById(pid);
                            File.Delete(pidPath);
                            break;
                        }
                    }
                    if (shell.HasExited) break;
                    await Task.Delay(100);
                }
            }
            if (owned == null) throw new InvalidOperationException("启动失败，请查看 logs/server.err.log。");
            File.WriteAllLines(Path.Combine(root, "logs", "managed-service.pid"), new[] {
                owned.Id.ToString(), owned.StartTime.ToUniversalTime().Ticks.ToString(), node
            });
            Log("服务进程已启动，PID " + owned.Id + "。数据库：" + Path.Combine(root, "scoring.db"));
            for (int i = 0; i < 30; i++) {
                if (owned.HasExited) throw new InvalidOperationException("服务意外退出，请查看 logs/server.err.log。");
                if (await IsScoringService()) {
                    await UpdateStatus();
                    Open(BaseUrl);
                    return;
                }
                await Task.Delay(400);
            }
            throw new InvalidOperationException("服务尚未就绪，请查看 logs/server.err.log；可点击停止后重试。");
        } catch (Exception ex) {
            status.Text = "启动未完成";
            status.ForeColor = Color.Firebrick;
            Log(ex.Message);
            if (File.Exists(Path.Combine(root, "logs", "server.err.log"))) {
                try { Log(string.Join(Environment.NewLine, File.ReadAllLines(Path.Combine(root, "logs", "server.err.log")).Reverse().Take(8).Reverse())); } catch { }
            }
        } finally {
            busy = false;
            start.Enabled = owned == null || owned.HasExited;
            stop.Enabled = owned != null && !owned.HasExited;
        }
    }

    async Task UpdateStatus()
    {
        ready = await IsScoringService();
        bool mine = owned != null && !owned.HasExited;
        if (ready) {
            status.Text = mine ? "● 服务运行中 · 可以开始评分" : "● 服务运行中 · 使用已有后台进程";
            status.ForeColor = Color.FromArgb(20, 125, 75);
            SetThreadExecutionState(0x80000001); // continuous + system required; display may sleep
        } else {
            status.Text = mine ? "● 服务进程存在，但网页暂时不可用，请查看日志" : "● 服务未运行";
            status.ForeColor = Color.Firebrick;
            SetThreadExecutionState(0x80000000);
        }
        start.Enabled = !ready && !mine;
        stop.Enabled = mine;
    }

    void AttachManagedProcess()
    {
        if (owned != null && !owned.HasExited) return;
        try {
            var lines = File.ReadAllLines(Path.Combine(root, "logs", "managed-service.pid"));
            var candidate = Process.GetProcessById(int.Parse(lines[0]));
            if (candidate.StartTime.ToUniversalTime().Ticks.ToString() == lines[1] &&
                string.Equals(candidate.MainModule.FileName, lines[2], StringComparison.OrdinalIgnoreCase)) owned = candidate;
            else candidate.Dispose();
        } catch { /* A stale PID must never grant control of another process. */ }
    }

    void StopService(bool confirm)
    {
        if (owned == null || owned.HasExited) return;
        if (confirm && MessageBox.Show("停止后，评委将无法继续提交评分。确定停止？", "停止评分服务", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try {
            owned.Kill();
            owned.WaitForExit(5000);
            owned.Dispose();
            owned = null;
            try { File.Delete(Path.Combine(root, "logs", "managed-service.pid")); } catch (IOException) { }
            ready = false;
            SetThreadExecutionState(0x80000000);
            status.Text = "● 服务已停止";
            status.ForeColor = Color.Firebrick;
            stop.Enabled = false;
            start.Enabled = true;
            Log("服务已停止。评分数据保留在 scoring.db；停止后可复制该文件备份。");
        } catch (Exception ex) { Log("停止失败：" + ex.Message); }
    }

    void RefreshAddresses()
    {
        string previous = (addresses.SelectedItem as AddressEntry ?? new AddressEntry()).Url;
        var entries = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback && n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
            .OrderByDescending(n => n.GetIPProperties().GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork))
            .ThenByDescending(n => n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211)
            .SelectMany(n => n.GetIPProperties().UnicastAddresses
                .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a.Address) && !a.Address.ToString().StartsWith("169.254."))
                .Select(a => new AddressEntry { Url = "http://" + a.Address + ":" + port + "/judge", Label = n.Name + "  —  http://" + a.Address + ":" + port + "/judge" }))
            .ToArray();
        addresses.BeginUpdate();
        addresses.Items.Clear();
        addresses.Items.AddRange(entries);
        if (entries.Length > 0) addresses.SelectedIndex = Math.Max(0, Array.FindIndex(entries, e => e.Url == previous));
        addresses.EndUpdate();
    }

    void Open(string url)
    {
        if (testing) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { Log("无法自动打开浏览器，请手动访问：" + url + "；" + ex.Message); }
    }

    void OnClosing(object sender, FormClosingEventArgs e)
    {
        if (busy) { e.Cancel = true; Log("正在检查服务，请稍后关闭。"); return; }
        if (owned != null && !owned.HasExited) {
            var answer = MessageBox.Show("是否同时停止评分服务？\n\n是：停止服务并关闭。\n否：保留后台服务并关闭（不再阻止自动休眠）。\n取消：继续运行启动器。", "关闭评分启动器", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
            if (answer == DialogResult.Cancel) { e.Cancel = true; return; }
            if (answer == DialogResult.Yes) StopService(false);
        }
        monitor.Stop();
        SetThreadExecutionState(0x80000000);
    }

    async Task SelfTest()
    {
        string report = Path.Combine(root, "launcher-test.txt");
        try {
            await StartService();
            if (owned == null || !await IsScoringService()) throw new Exception("Start or health check failed");
            int first = owned.Id;
            await StartService();
            if (owned.Id != first) throw new Exception("Duplicate start created a new process");
            using (var bitmap = new Bitmap(Width, Height)) {
                DrawToBitmap(bitmap, new Rectangle(0, 0, Width, Height));
                bitmap.Save(Path.Combine(root, "launcher-preview.png"), System.Drawing.Imaging.ImageFormat.Png);
            }
            StopService(false);
            if (PortInUse()) throw new Exception("Port still in use after stopping");
            await StartService();
            if (owned == null || !await IsScoringService()) throw new Exception("Restart failed");
            int restartedPid = owned.Id;
            owned.Dispose();
            owned = null;
            AttachManagedProcess();
            if (owned == null || owned.Id != restartedPid) throw new Exception("Managed process reattachment failed");
            StopService(false);
            File.WriteAllText(report, "PASS: startup, HTTP readiness, duplicate start, stop, restart, managed process reattachment, address enumeration, UI render.\r\n" + details.Text, Encoding.UTF8);
        } catch (Exception ex) {
            StopService(false);
            File.WriteAllText(report, "FAIL: " + ex + "\r\n" + details.Text, Encoding.UTF8);
            Environment.ExitCode = 1;
        }
        Close();
    }
}
