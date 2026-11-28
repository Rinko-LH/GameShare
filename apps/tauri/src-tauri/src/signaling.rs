use axum::{http::Method, routing::get, Json, Router};
use serde::Serialize;
use serde_json::{json, Value};
use socket2::{Domain, Protocol, Socket, Type};
use socketioxide::{
    extract::{AckSender, SocketRef, TryData},
    SocketIo,
};
use std::{
    collections::HashMap,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State, WebviewWindow};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::AbortHandle,
};
use tower_http::cors::{Any, CorsLayer};

const PORT: u16 = 8080;
const ROOM_CODE: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const QUALITIES: [&str; 4] = ["THUMBNAIL", "GRID", "FOCUS", "FOCUS_HIGH"];

struct Peer {
    socket: SocketRef,
    id: String,
    nickname: String,
    joined_at: u64,
    quality: String,
    sharing: bool,
}

impl Peer {
    fn new(socket: SocketRef, payload: &Value) -> Self {
        let id = socket.id.to_string();
        let nickname: String = payload["nickname"]
            .as_str()
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(16)
            .collect();
        Self {
            nickname: if nickname.is_empty() {
                format!("玩家{}", &id[..4])
            } else {
                nickname
            },
            id,
            socket,
            joined_at: now(),
            quality: "GRID".into(),
            sharing: false,
        }
    }
    fn info(&self, host: bool) -> Value {
        json!({"peerId": self.id, "nickname": self.nickname, "isHost": host,
            "joinedAt": self.joined_at, "sharing": self.sharing, "shareQuality": self.quality})
    }
}

struct Room {
    allow_ip_join: bool,
    peers: Vec<Peer>, // 保持加入顺序，第一位成员即当前房主。
}

#[derive(Default)]
struct Rooms {
    by_code: HashMap<String, Room>,
    membership: HashMap<String, String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn error(code: &str, message: &str) -> Value {
    json!({"code": code, "message": message})
}

fn ack(ack: AckSender, result: Result<Value, Value>) {
    let response = match result {
        Ok(data) => json!({"ok": true, "data": data}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let _ = ack.send(&response);
}

impl Rooms {
    fn enter(&mut self, socket: SocketRef, payload: Value, create: bool) -> Result<Value, Value> {
        if self.membership.contains_key(&socket.id.to_string()) {
            return Err(error("ALREADY_IN_ROOM", "当前连接已在房间中，请先离开"));
        }
        if create {
            let code = (0..200)
                .find_map(|_| {
                    let mut raw = [0u8; 6];
                    getrandom::fill(&mut raw).ok()?;
                    let code: String = raw
                        .iter()
                        .map(|byte| ROOM_CODE[*byte as usize % ROOM_CODE.len()] as char)
                        .collect();
                    (!self.by_code.contains_key(&code)).then_some(code)
                })
                .ok_or_else(|| error("INTERNAL", "无法生成房间码"))?;
            let peer = Peer::new(socket, &payload);
            let data = json!({"roomCode": code, "self": peer.info(true), "peers": []});
            self.membership.insert(peer.id.clone(), code.clone());
            self.by_code.insert(
                code,
                Room {
                    allow_ip_join: payload["allowIpJoin"] == true,
                    peers: vec![peer],
                },
            );
            return Ok(data);
        }

        let code = if payload["joinByIp"] == true {
            let mut candidates = self.by_code.iter().filter(|(_, room)| room.allow_ip_join);
            let candidate = candidates.next().filter(|_| candidates.next().is_none());
            candidate
                .map(|(code, _)| code.clone())
                .ok_or_else(|| error("ROOM_NOT_FOUND", "没有唯一的 IP 共享房间，请填写房间码"))?
        } else {
            payload["roomCode"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_ascii_uppercase()
        };
        let room = self
            .by_code
            .get_mut(&code)
            .ok_or_else(|| error("ROOM_NOT_FOUND", "房间不存在"))?;
        if room.peers.len() >= 8 {
            return Err(error("ROOM_FULL", "房间已满（上限 8 人）"));
        }
        let peer = Peer::new(socket, &payload);
        let self_info = peer.info(false);
        let others: Vec<_> = room
            .peers
            .iter()
            .enumerate()
            .map(|(index, peer)| peer.info(index == 0))
            .collect();
        for existing in &room.peers {
            let _ = existing
                .socket
                .emit("peer-joined", &json!({"peer": self_info}));
        }
        self.membership.insert(peer.id.clone(), code.clone());
        room.peers.push(peer);
        Ok(json!({"roomCode": code, "self": self_info, "peers": others}))
    }

    fn leave(&mut self, id: &str, reason: &str) -> Result<Value, Value> {
        let code = self
            .membership
            .remove(id)
            .ok_or_else(|| error("NOT_IN_ROOM", "当前连接不在房间中"))?;
        let room = self.by_code.get_mut(&code).expect("indexed room exists");
        let host_left = room.peers[0].id == id;
        room.peers.retain(|peer| peer.id != id);
        if room.peers.is_empty() {
            self.by_code.remove(&code);
        } else {
            let update = host_left.then(|| json!({"peer": room.peers[0].info(true)}));
            for peer in &room.peers {
                let _ = peer
                    .socket
                    .emit("peer-left", &json!({"peerId": id, "reason": reason}));
                if let Some(update) = &update {
                    let _ = peer.socket.emit("peer-updated", update);
                }
            }
        }
        Ok(json!({"roomCode": code}))
    }

    fn share(
        &mut self,
        socket: &SocketRef,
        event: &str,
        payload: &Value,
        sharing: bool,
    ) -> Result<(), Value> {
        let id = socket.id.to_string();
        let code = self
            .membership
            .get(&id)
            .ok_or_else(|| error("NOT_IN_ROOM", "当前连接不在房间中"))?;
        let room = self.by_code.get_mut(code).expect("indexed room exists");
        let peer = room
            .peers
            .iter_mut()
            .find(|peer| peer.id == id)
            .expect("indexed peer exists");
        peer.sharing = sharing;
        if sharing {
            if let Some(quality) = payload["quality"]
                .as_str()
                .filter(|quality| QUALITIES.contains(quality))
            {
                peer.quality = quality.into();
            }
        }
        let data = if sharing {
            json!({"peerId": id, "sharing": true, "quality": peer.quality})
        } else {
            json!({"peerId": id, "sharing": false})
        };
        for peer in room.peers.iter().filter(|peer| peer.id != id) {
            let _ = peer.socket.emit(event, &data);
        }
        Ok(())
    }

    fn relay(&self, socket: &SocketRef, event: &str, payload: &Value) -> Result<(), Value> {
        let id = socket.id.to_string();
        let code = self
            .membership
            .get(&id)
            .ok_or_else(|| error("NOT_IN_ROOM", "当前连接不在房间中"))?;
        let target = payload["targetPeerId"]
            .as_str()
            .filter(|target| !target.is_empty() && *target != id)
            .ok_or_else(|| error("INVALID_PAYLOAD", "无效的目标成员"))?;
        let peer = self.by_code[code]
            .peers
            .iter()
            .find(|peer| peer.id == target)
            .ok_or_else(|| error("TARGET_NOT_FOUND", "目标成员不在同一房间"))?;
        let valid = match event {
            "webrtc-offer" | "webrtc-answer" => payload["sdp"]
                .as_str()
                .is_some_and(|sdp| !sdp.is_empty() && sdp.len() <= 256 * 1024),
            "ice-candidate" => payload["candidate"]
                .as_str()
                .is_some_and(|candidate| candidate.len() <= 4096),
            "view-quality" => {
                matches!(payload["mode"].as_str(), Some("thumbnail" | "default"))
                    && payload["revision"]
                        .as_u64()
                        .is_some_and(|revision| (1..=9_007_199_254_740_991).contains(&revision))
            }
            _ => payload["level"]
                .as_str()
                .is_some_and(|quality| QUALITIES.contains(&quality)),
        };
        if !valid {
            return Err(error("INVALID_PAYLOAD", "信令字段无效或超出长度上限"));
        }
        let _ = peer
            .socket
            .emit(event, &json!({"fromPeerId": id, "payload": payload}));
        Ok(())
    }
}

fn connect(socket: SocketRef, rooms: Arc<Mutex<Rooms>>) {
    for (event, create) in [("create-room", true), ("join-room", false)] {
        let rooms = rooms.clone();
        socket.on(
            event,
            async move |socket: SocketRef, TryData(payload): TryData<Value>, sender: AckSender| {
                ack(
                    sender,
                    rooms
                        .lock()
                        .unwrap()
                        .enter(socket, payload.unwrap_or_default(), create),
                );
            },
        );
    }
    let members = rooms.clone();
    socket.on(
        "leave-room",
        async move |socket: SocketRef, sender: AckSender| {
            ack(
                sender,
                members
                    .lock()
                    .unwrap()
                    .leave(&socket.id.to_string(), "leave"),
            );
        },
    );
    let members = rooms.clone();
    socket.on_disconnect(async move |socket: SocketRef| {
        let _ = members
            .lock()
            .unwrap()
            .leave(&socket.id.to_string(), "disconnect");
    });
    for (event, sharing) in [("share-started", true), ("share-stopped", false)] {
        let rooms = rooms.clone();
        socket.on(
            event,
            async move |socket: SocketRef, TryData(payload): TryData<Value>| {
                if let Err(error) = rooms.lock().unwrap().share(
                    &socket,
                    event,
                    &payload.unwrap_or_default(),
                    sharing,
                ) {
                    let _ = socket.emit("protocol-error", &error);
                }
            },
        );
    }
    for event in [
        "webrtc-offer",
        "webrtc-answer",
        "ice-candidate",
        "quality-request",
        "quality-changed",
        "view-quality",
    ] {
        let rooms = rooms.clone();
        socket.on(
            event,
            async move |socket: SocketRef, TryData(payload): TryData<Value>| {
                if let Err(error) =
                    rooms
                        .lock()
                        .unwrap()
                        .relay(&socket, event, &payload.unwrap_or_default())
                {
                    let _ = socket.emit("protocol-error", &error);
                }
            },
        );
    }
    socket.on(
        "heartbeat",
        async |TryData(payload): TryData<Value>, sender: AckSender| {
            let sent_at = payload
                .ok()
                .and_then(|value| value["sentAt"].as_u64())
                .unwrap_or_else(now);
            ack(sender, Ok(json!({"sentAt": sent_at, "serverAt": now()})));
        },
    );
}

fn listen() -> io::Result<(TcpListener, bool)> {
    for dual in [true, false] {
        let result = (|| {
            let address = if dual {
                IpAddr::V6(Ipv6Addr::UNSPECIFIED)
            } else {
                IpAddr::V4(Ipv4Addr::UNSPECIFIED)
            };
            let socket = Socket::new(
                Domain::for_address(SocketAddr::new(address, PORT)),
                Type::STREAM,
                Some(Protocol::TCP),
            )?;
            if dual {
                socket.set_only_v6(false)?;
            }
            socket.bind(&SocketAddr::new(address, PORT).into())?;
            socket.listen(128)?;
            socket.set_nonblocking(true)?;
            Ok((TcpListener::from_std(socket.into())?, dual))
        })();
        if result.is_ok() || !dual {
            return result;
        }
    }
    unreachable!()
}

struct Server {
    task: AbortHandle,
    io: SocketIo,
    dual: bool,
}

#[derive(Default)]
pub struct Signaling(tokio::sync::Mutex<Option<Server>>);

fn spawn(listener: TcpListener, dual: bool) -> Server {
    let rooms = Arc::new(Mutex::new(Rooms::default()));
    let (layer, io) = SocketIo::builder()
        .ping_interval(Duration::from_secs(20))
        .ping_timeout(Duration::from_secs(25))
        .max_payload(1_000_000)
        .build_layer();
    let peers = rooms.clone();
    io.ns("/", async move |socket: SocketRef| {
        connect(socket, peers.clone())
    });
    let started = std::time::Instant::now();
    let health = move || {
        let rooms = rooms.clone();
        async move {
            let rooms = rooms.lock().unwrap();
            Json(
                json!({"ok": true, "service": "game-share-signaling", "protocolVersion": 1,
                "rooms": rooms.by_code.len(), "peers": rooms.membership.len(),
                "uptimeSec": started.elapsed().as_secs(), "turn": {"enabled": false}}),
            )
        }
    };
    let app = Router::new()
        .route("/health", get(health.clone()))
        .route("/", get(health))
        .layer(layer)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST]),
        );
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    })
    .abort_handle();
    Server { task, io, dual }
}

async fn existing_origin() -> Option<String> {
    for ip in [
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(Ipv6Addr::LOCALHOST),
    ] {
        let address = SocketAddr::new(ip, PORT);
        let result = tokio::time::timeout(Duration::from_millis(700), async {
            let mut stream = TcpStream::connect(address).await.ok()?;
            stream
                .write_all(
                    format!("GET /health HTTP/1.0\r\nHost: {address}\r\nConnection: close\r\n\r\n")
                        .as_bytes(),
                )
                .await
                .ok()?;
            let mut response = Vec::new();
            stream.take(16384).read_to_end(&mut response).await.ok()?;
            let response = std::str::from_utf8(&response).ok()?;
            let (head, body) = response.split_once("\r\n\r\n")?;
            let payload: Value = serde_json::from_str(body).ok()?;
            (head.split_whitespace().nth(1) == Some("200")
                && payload["ok"] == true
                && payload["service"] == "game-share-signaling")
                .then_some(format!("http://{address}"))
        })
        .await;
        if let Ok(Some(url)) = result {
            return Some(url);
        }
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Adapter {
    interface_name: String,
    address: String,
    family: &'static str,
}

fn status(state: &str, dual: bool, local_url: String, detail: Option<String>) -> Value {
    let mut media = Vec::new();
    let mut lan = Vec::new();
    let mut public_v4 = Vec::new();
    let mut public_v6 = Vec::new();
    for entry in if_addrs::get_if_addrs().unwrap_or_default() {
        let ip = entry.ip();
        if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
            continue;
        }
        let url = format!("http://{}", SocketAddr::new(ip, PORT));
        match ip {
            IpAddr::V4(ip) if ip.is_link_local() => continue,
            IpAddr::V4(ip)
                if ip.is_private()
                    || ((u32::from(ip) >> 22)
                        == (u32::from(Ipv4Addr::new(100, 64, 0, 0)) >> 22)) =>
            {
                lan.push(url)
            }
            IpAddr::V4(_) => public_v4.push(url),
            IpAddr::V6(ip) if ip.is_unicast_link_local() => continue,
            IpAddr::V6(ip) if ip.segments()[0] & 0xe000 == 0x2000 => public_v6.push(url),
            IpAddr::V6(_) => {}
        }
        media.push(Adapter {
            interface_name: entry.name,
            address: ip.to_string(),
            family: if ip.is_ipv4() { "IPv4" } else { "IPv6" },
        });
    }
    let recommended = lan
        .first()
        .or_else(|| public_v6.first())
        .or_else(|| public_v4.first());
    json!({"enabled": state != "stopped", "state": state, "port": PORT, "dualStack": dual,
        "localUrl": local_url, "lanUrls": lan, "publicV4Urls": public_v4, "publicV6Urls": public_v6,
        "mediaAddresses": media, "recommendedUrl": recommended, "detail": detail,
        "turnState": "off", "turnIssued": 0})
}

fn loopback_url(dual: bool) -> String {
    let host = if dual { "[::1]" } else { "127.0.0.1" };
    format!("http://{host}:{PORT}")
}

impl Signaling {
    pub async fn loopback_origin(&self) -> Option<String> {
        let own = self
            .0
            .lock()
            .await
            .as_ref()
            .filter(|server| !server.task.is_finished())
            .map(|server| loopback_url(server.dual));
        if own.is_some() {
            own
        } else {
            existing_origin().await
        }
    }
}

#[tauri::command]
pub async fn signaling_status(
    window: WebviewWindow,
    state: State<'_, Signaling>,
) -> Result<Value, String> {
    super::require_main(&window)?;
    let dual = state
        .0
        .lock()
        .await
        .as_ref()
        .filter(|server| !server.task.is_finished())
        .map(|server| server.dual);
    Ok(status(
        if dual.is_some() { "running" } else { "stopped" },
        dual.unwrap_or(false),
        loopback_url(dual.unwrap_or(false)),
        None,
    ))
}

#[tauri::command]
pub async fn set_signaling(
    window: WebviewWindow,
    state: State<'_, Signaling>,
    enabled: bool,
    tunnel: State<'_, super::tunnel::Tunnel>,
) -> Result<Value, String> {
    super::require_main(&window)?;
    let _tunnel_control = if enabled {
        None
    } else {
        let mut control = tunnel.control().await;
        control.stop(window.app_handle()).await;
        Some(control)
    };
    let mut server = state.0.lock().await;
    let local = loopback_url(false);
    if !enabled {
        if let Some(server) = server.take() {
            server.io.close().await;
            server.task.abort();
        }
        return Ok(status("stopped", false, local, None));
    }
    if let Some(server) = server.as_ref().filter(|server| !server.task.is_finished()) {
        return Ok(status(
            "running",
            server.dual,
            loopback_url(server.dual),
            None,
        ));
    }
    Ok(match listen() {
        Ok((listener, dual)) => {
            *server = Some(spawn(listener, dual));
            status("running", dual, loopback_url(dual), None)
        }
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => match existing_origin().await {
            Some(url) => status(
                "port-in-use",
                false,
                url,
                Some("复用本机正在运行的 GameShare 信令服务。".into()),
            ),
            None => status(
                "failed",
                false,
                local,
                Some(format!("端口 {PORT} 已被其他程序占用。")),
            ),
        },
        Err(error) => status("failed", false, local, Some(error.to_string())),
    })
}
