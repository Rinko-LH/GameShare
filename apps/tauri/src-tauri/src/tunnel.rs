use reqwest::{redirect::Policy, Client};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::{self, Write},
    mem::{size_of, zeroed},
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::{
    fs::File,
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::{Child, ChildStderr, Command},
    sync::{oneshot, Mutex as AsyncMutex, MutexGuard},
    task::JoinHandle,
    time::{sleep, timeout},
};
use windows_sys::Win32::System::{
    JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
    Threading::CREATE_NO_WINDOW,
};

const CLOUDFLARED_VERSION: &str = "2026.11.2";
// https://github.com/cloudflare/cloudflared/releases/tag/2026.11.2
const WINDOWS_X64_SHA256: [u8; 32] = [
    0x55, 0x5b, 0x46, 0xc8, 0x55, 0x82, 0x46, 0x1d, 0x18, 0x9c, 0xac, 0x30, 0xd1, 0x4a, 0xd0, 0x54,
    0x80, 0xd6, 0x12, 0x61, 0x38, 0x01, 0xbe, 0x9f, 0x11, 0x0b, 0x8c, 0xe0, 0x8c, 0x5b, 0x21, 0x13,
];
const WINDOWS_X64_BYTES: u64 = 55_470_800;
const START_TIMEOUT: Duration = Duration::from_secs(50);

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Clone, Serialize)]
pub struct TunnelStatus {
    available: bool,
    enabled: bool,
    state: Phase,
    url: Option<String>,
    detail: Option<String>,
}

impl TunnelStatus {
    fn new(state: Phase, url: Option<String>, detail: Option<String>) -> Self {
        Self {
            available: executable_path().is_some(),
            enabled: state != Phase::Stopped,
            state,
            url,
            detail,
        }
    }
}

#[derive(Clone)]
struct Status(Arc<Mutex<TunnelStatus>>);

impl Default for Status {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(TunnelStatus::new(
            Phase::Stopped,
            None,
            None,
        ))))
    }
}

impl Status {
    fn get(&self) -> TunnelStatus {
        self.0.lock().unwrap().clone()
    }

    fn publish(&self, app: &AppHandle, next: TunnelStatus) -> TunnelStatus {
        *self.0.lock().unwrap() = next.clone();
        let _ = app.emit_to("main", "tunnel-status", &next);
        next
    }
}

struct Worker {
    stop: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

#[derive(Default)]
pub struct Tunnel {
    // 串行化启停及信令服务关闭。后台任务只写状态，不持有此锁。
    worker: AsyncMutex<Option<Worker>>,
    status: Status,
}

pub struct TunnelControl<'a> {
    manager: &'a Tunnel,
    worker: MutexGuard<'a, Option<Worker>>,
}

impl Tunnel {
    pub async fn control(&self) -> TunnelControl<'_> {
        TunnelControl {
            manager: self,
            worker: self.worker.lock().await,
        }
    }
}

impl TunnelControl<'_> {
    async fn finish_worker(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.stop.send(());
            let _ = worker.task.await;
        }
    }

    pub async fn stop(&mut self, app: &AppHandle) -> TunnelStatus {
        self.finish_worker().await;
        self.manager
            .status
            .publish(app, TunnelStatus::new(Phase::Stopped, None, None))
    }

    async fn start(
        &mut self,
        app: &AppHandle,
        signaling: &super::signaling::Signaling,
    ) -> TunnelStatus {
        let current = self.manager.status.get();
        if matches!(current.state, Phase::Starting | Phase::Running) {
            return current;
        }
        self.finish_worker().await;
        let fail = |detail: String| {
            self.manager
                .status
                .publish(app, TunnelStatus::new(Phase::Failed, None, Some(detail)))
        };
        let Some(path) = executable_path() else {
            return fail("未找到随包提供的 cloudflared.exe，请完整解压发布 ZIP。".into());
        };
        let Some(origin) = signaling.loopback_origin().await else {
            return fail("未找到本机 GameShare 信令服务，请先开启信令或创建房间。".into());
        };
        let status = self.manager.status.clone();
        let initial = status.publish(
            app,
            TunnelStatus::new(
                Phase::Starting,
                None,
                Some("正在检查 Cloudflare 隧道组件…".into()),
            ),
        );
        let (stop, stopped) = oneshot::channel();
        let app = app.clone();
        let task = tokio::spawn(async move {
            if let Err(error) = supervise(&app, &status, &path, &origin, stopped).await {
                status.publish(&app, TunnelStatus::new(Phase::Failed, None, Some(error)));
            }
        });
        *self.worker = Some(Worker { stop, task });
        initial
    }
}

#[tauri::command]
pub fn tunnel_status(
    window: WebviewWindow,
    tunnel: State<'_, Tunnel>,
) -> Result<TunnelStatus, String> {
    super::require_main(&window)?;
    let mut status = tunnel.status.get();
    status.available = executable_path().is_some();
    Ok(status)
}

#[tauri::command]
pub async fn set_tunnel(
    window: WebviewWindow,
    tunnel: State<'_, Tunnel>,
    signaling: State<'_, super::signaling::Signaling>,
    enabled: bool,
) -> Result<TunnelStatus, String> {
    super::require_main(&window)?;
    let mut operation = tunnel.control().await;
    let app = window.app_handle();
    Ok(if enabled {
        operation.start(app, &signaling).await
    } else {
        operation.stop(app).await
    })
}

async fn verified(path: &Path) -> io::Result<bool> {
    let mut file = match File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if file.metadata().await?.len() != WINDOWS_X64_BYTES {
        return Ok(false);
    }
    let mut buf = vec![0; 64 * 1024];
    let mut hash = Sha256::new();
    loop {
        let count = file.read(&mut buf).await?;
        if count == 0 {
            break;
        }
        hash.update(&buf[..count]);
    }
    Ok(hash.finalize().as_slice() == WINDOWS_X64_SHA256)
}

fn executable_path() -> Option<PathBuf> {
    if !cfg!(target_arch = "x86_64") {
        return None;
    }
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|folder| folder.join("cloudflared.exe")));
    bundled.filter(|path| path.is_file()).or_else(|| {
        let path = PathBuf::from(std::env::var_os("GAMESHARE_CLOUDFLARED")?);
        path.canonicalize().ok().filter(|path| path.is_file())
    })
}

fn start_process(path: &Path, config: &Path, origin: &str) -> io::Result<(Child, OwnedHandle)> {
    // Job Object 最后一个句柄关闭时，Windows 会回收对应的 cloudflared 进程。
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    let job = unsafe { OwnedHandle::from_raw_handle(handle) };
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let set = unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if set == 0 {
        return Err(io::Error::last_os_error());
    }

    let mut command = Command::new(path);
    command
        .arg("tunnel")
        .arg("--config")
        .arg(config)
        .args(["--no-autoupdate", "--output", "json", "--url", origin])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true);
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("TUNNEL_")
        {
            command.env_remove(name);
        }
    }
    let child = command.spawn()?;
    let process = child
        .raw_handle()
        .ok_or_else(|| io::Error::other("cloudflared 进程句柄不可用"))?;
    if unsafe { AssignProcessToJobObject(job.as_raw_handle(), process) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((child, job))
}

fn tunnel_url(line: &str) -> Option<String> {
    let log = serde_json::from_str::<serde_json::Value>(line).ok();
    let text = log
        .as_ref()
        .and_then(|value| value["message"].as_str())
        .unwrap_or(line);
    let host = text
        .split_whitespace()
        .filter_map(|word| {
            word.trim_matches(|ch: char| matches!(ch, '|' | '"' | '\'' | '(' | ')' | '│'))
                .strip_prefix("https://")
        })
        .find(|host| {
            host.strip_suffix(".trycloudflare.com")
                .is_some_and(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label.bytes().all(|byte| {
                            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                        })
                })
        })?;
    Some(format!("https://{host}"))
}

async fn read_log(pipe: ChildStderr, sender: oneshot::Sender<String>) {
    let mut sender = Some(sender);
    let mut lines = BufReader::new(pipe).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(url) = sender.as_ref().and_then(|_| tunnel_url(&line)) {
            if let Some(sender) = sender.take() {
                let _ = sender.send(url);
            }
        }
    }
}

async fn health_ok(client: &Client, origin: &str) -> bool {
    let mut response = match client
        .get(format!("{origin}/health"))
        .timeout(Duration::from_secs(4))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        _ => return false,
    };
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 16384 => {
                bytes.extend_from_slice(&chunk)
            }
            Ok(None) => break,
            _ => return false,
        }
    }
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .is_ok_and(|payload| payload["ok"] == true && payload["service"] == "game-share-signaling")
}

async fn supervise(
    app: &AppHandle,
    status: &Status,
    path: &Path,
    origin: &str,
    mut stopped: oneshot::Receiver<()>,
) -> Result<(), String> {
    let verified = tokio::select! {
        biased;
        _ = &mut stopped => return Ok(()),
        result = verified(path) => result.map_err(|error| format!("无法读取 cloudflared.exe：{error}"))?,
    };
    if !verified {
        return Err(format!("cloudflared.exe 的 SHA-256 校验失败，请重新解压带有 {CLOUDFLARED_VERSION} 组件的发布 ZIP。"));
    }
    // 使用独立空配置，避免使用同一电脑上其他 Cloudflare 隧道的 ingress 配置。
    let mut config = tempfile::NamedTempFile::new().map_err(|error| error.to_string())?;
    config
        .write_all(b"{}\n")
        .map_err(|error| error.to_string())?;
    let config = config.into_temp_path();
    status.publish(
        app,
        TunnelStatus::new(Phase::Starting, None, Some("正在申请临时网址…".into())),
    );
    let (mut child, _job) = start_process(path, &config, origin)
        .map_err(|error| format!("无法启动 cloudflared：{error}"))?;
    let (url_out, url_in) = oneshot::channel();
    let log = tokio::spawn(read_log(
        child.stderr.take().expect("cloudflared stderr is piped"),
        url_out,
    ));

    let probe = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("无法初始化隧道检测：{error}"))?;
    let ready = async {
        let url = url_in
            .await
            .map_err(|_| "cloudflared 在分配临时网址前关闭了输出。")?;
        // 已生成网址时，Cloudflare 连接和本机端口映射可能还未就绪。
        status.publish(
            app,
            TunnelStatus::new(
                Phase::Starting,
                None,
                Some("临时网址已生成，正在验证公网信令…".into()),
            ),
        );
        loop {
            if health_ok(&probe, &url).await {
                return Ok::<_, &str>(url);
            }
            sleep(Duration::from_secs(1)).await;
        }
    };
    let outcome = tokio::select! {
        biased;
        _ = &mut stopped => Ok(()),
        exit = child.wait() => Err(unexpected_exit(exit)),
        result = timeout(START_TIMEOUT, ready) => match result {
            Ok(Ok(url)) => {
                status.publish(app, TunnelStatus::new(Phase::Running, Some(url), None));
                tokio::select! {
                    biased;
                    _ = &mut stopped => Ok(()),
                    exit = child.wait() => Err(unexpected_exit(exit)),
                }
            }
            Ok(Err(error)) => Err(error.into()),
            Err(_) => Err("50 秒内未能验证 Cloudflare 信令入口，请检查网络后重试。".into()),
        },
    };
    let _ = child.kill().await;
    log.abort();
    outcome
}

fn unexpected_exit(status: io::Result<std::process::ExitStatus>) -> String {
    match status {
        Ok(status) => format!("cloudflared 已退出（{status}），请检查网络后重试。"),
        Err(error) => format!("无法读取 cloudflared 状态：{error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::tunnel_url;

    #[test]
    fn extracts_only_cloudflare_generated_https_hosts() {
        assert_eq!(
            tunnel_url(r#"{"message":"| https://red-fox-123.trycloudflare.com |"}"#).as_deref(),
            Some("https://red-fox-123.trycloudflare.com")
        );
        assert!(tunnel_url("http://test.trycloudflare.com").is_none());
        assert!(tunnel_url("https://test.trycloudflare.com.example.org").is_none());
        assert!(tunnel_url("https://example.org/test.trycloudflare.com").is_none());
    }
}
