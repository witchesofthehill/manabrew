use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serenity::all::{
    ChannelId, ChannelType, ClientBuilder, Context, CreateAllowedMentions, CreateEmbed,
    CreateEmbedAuthor, CreateMessage, CreateThread, EditThread, EventHandler, GatewayIntents,
    GuildId, Http, Message, MessageId, MessageType, Nonce, RoleId,
};
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, Mutex};
use tracing::{info, warn};

use crate::chat::unix_time_ms;
use crate::connection::publish_chat;
use crate::protocol::{ChatMessage, ChatScope, CHAT_MESSAGE_MAX_CHARS};
use crate::state::ServerState;

const CAPACITY: usize = 1024;
const SEEN_CAPACITY: usize = 4096;
type BridgeResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

struct Config {
    token: String,
    guild: GuildId,
    channel: ChannelId,
    roles: Vec<RoleId>,
    path: PathBuf,
}

impl Config {
    fn from_env() -> BridgeResult<Option<Self>> {
        let token = std::env::var("DISCORD_BOT_TOKEN").unwrap_or_default();
        if token.trim().is_empty() {
            return Ok(None);
        }
        let guild = std::env::var("DISCORD_CHAT_GUILD_ID")?.parse::<GuildId>()?;
        let channel = std::env::var("DISCORD_CHAT_CHANNEL_ID")?.parse::<ChannelId>()?;
        let roles = std::env::var("DISCORD_CHAT_ADMIN_ROLE_IDS")?
            .split(',')
            .map(|role| role.trim().parse::<RoleId>())
            .collect::<Result<Vec<_>, _>>()?;
        if roles.is_empty() || roles.iter().any(|role| role.get() == guild.get()) {
            return Err("Discord chat requires an admin role other than @everyone".into());
        }
        Ok(Some(Self {
            token,
            guild,
            channel,
            roles,
            path: std::env::var("DISCORD_CHAT_STATE_PATH")
                .unwrap_or_else(|_| "discord-chat.json".into())
                .into(),
        }))
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Outgoing {
    conversation_id: String,
    room_name: String,
    sender: String,
    content: String,
    nonce: String,
}

pub struct ChatBridge {
    sender: mpsc::Sender<Outgoing>,
}

impl ChatBridge {
    pub fn forward(&self, message: &ChatMessage, room_name: &str) {
        let event = Outgoing {
            conversation_id: message
                .room_id
                .as_ref()
                .map(|id| format!("room:{id}"))
                .unwrap_or_else(|| "lobby".into()),
            room_name: room_name.into(),
            sender: message.from.clone(),
            content: message.text.clone(),
            nonce: nonce(&uuid::Uuid::new_v4().to_string()),
        };
        if self.sender.try_send(event).is_err() {
            warn!("Discord chat queue unavailable; mirror message dropped");
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Thread {
    id: ChannelId,
    ready: bool,
}

#[derive(Serialize, Deserialize)]
struct Registry {
    guild: GuildId,
    channel: ChannelId,
    threads: HashMap<String, Thread>,
    pending: VecDeque<Outgoing>,
    sent: VecDeque<String>,
    received: VecDeque<MessageId>,
}

impl Registry {
    async fn load(config: &Config) -> BridgeResult<Self> {
        match tokio::fs::read(&config.path).await {
            Ok(bytes) => {
                let registry: Self = serde_json::from_slice(&bytes)?;
                if registry.guild != config.guild || registry.channel != config.channel {
                    return Err("Discord chat state belongs to another server/channel; use a separate state path".into());
                }
                Ok(registry)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                guild: config.guild,
                channel: config.channel,
                threads: HashMap::new(),
                pending: VecDeque::new(),
                sent: VecDeque::new(),
                received: VecDeque::new(),
            }),
            Err(error) => Err(error.into()),
        }
    }

    async fn save(&self, config: &Config) -> BridgeResult<()> {
        if let Some(parent) = config.path.parent().filter(|p| !p.as_os_str().is_empty()) {
            tokio::fs::create_dir_all(parent).await?;
        }
        let temporary = config.path.with_extension("json.tmp");
        tokio::fs::write(&temporary, serde_json::to_vec(self)?).await?;
        tokio::fs::rename(temporary, &config.path).await?;
        Ok(())
    }
}

pub fn start(state: Arc<ServerState>) {
    let config = match Config::from_env() {
        Ok(Some(config)) => Arc::new(config),
        Ok(None) => return,
        Err(error) => {
            warn!(%error, "Discord chat configuration invalid; bridge disabled");
            return;
        }
    };
    let (sender, receiver) = mpsc::channel(CAPACITY);
    if state.discord_chat.set(ChatBridge { sender }).is_err() {
        return;
    }
    tokio::spawn(async move {
        if let Err(error) = run(state, config, receiver).await {
            warn!(%error, "Discord chat bridge stopped");
        }
    });
}

async fn run(
    state: Arc<ServerState>,
    config: Arc<Config>,
    receiver: mpsc::Receiver<Outgoing>,
) -> BridgeResult<()> {
    let registry = Arc::new(Mutex::new(Registry::load(&config).await?));
    registry.lock().await.save(&config).await?;
    let handler = Handler {
        state,
        config: config.clone(),
        registry: registry.clone(),
    };
    let intents =
        GatewayIntents::GUILDS | GatewayIntents::GUILD_MESSAGES | GatewayIntents::MESSAGE_CONTENT;
    let http = serenity::http::HttpBuilder::new(&config.token)
        .client(
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()?,
        )
        .build();
    let mut client = ClientBuilder::new_with_http(http, intents)
        .event_handler(handler)
        .await?;
    let channel = config
        .channel
        .to_channel(&client.http)
        .await?
        .guild()
        .ok_or("Discord chat destination must be a server text channel")?;
    if channel.guild_id != config.guild || channel.kind != ChannelType::Text {
        return Err(
            "Discord chat destination must be a text channel in the configured server".into(),
        );
    }
    info!(guild = %config.guild, channel = %config.channel, "Discord chat bridge starting");
    let http = client.http.clone();
    tokio::select! {
        result = client.start() => result.map_err(Into::into),
        result = writer(config, registry, http, receiver) => result,
    }
}

async fn writer(
    config: Arc<Config>,
    registry: Arc<Mutex<Registry>>,
    http: Arc<Http>,
    mut receiver: mpsc::Receiver<Outgoing>,
) -> BridgeResult<()> {
    let mut interval = tokio::time::interval(Duration::from_millis(250));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut retries: HashMap<String, (u32, tokio::time::Instant)> = HashMap::new();
    loop {
        tokio::select! {
            event = receiver.recv() => {
                let Some(event) = event else { return Ok(()); };
                let mut data = registry.lock().await;
                if data.sent.contains(&event.nonce)
                    || data.pending.iter().any(|pending| pending.nonce == event.nonce) {
                    continue;
                }
                if data.pending.len() >= CAPACITY {
                    warn!(room_id = %event.conversation_id, "Discord chat outbox full; mirror message dropped");
                    continue;
                }
                data.pending.push_back(event);
                data.save(&config).await?;
            }
            _ = interval.tick() => {
                let event = registry.lock().await.pending.iter().enumerate()
                    .find(|(_, event)| retries.get(&event.conversation_id)
                        .is_none_or(|(_, at)| tokio::time::Instant::now() >= *at))
                    .map(|(index, event)| (index, event.clone()));
                let Some((index, event)) = event else { continue; };
                match deliver(&config, &registry, &http, &event).await {
                    Ok(()) => {
                        let mut data = registry.lock().await;
                        data.pending.remove(index);
                        remember(&mut data.sent, event.nonce);
                        data.save(&config).await?;
                        retries.remove(&event.conversation_id);
                    }
                    Err(error) => {
                        let retry = retries.entry(event.conversation_id.clone())
                            .or_insert((0, tokio::time::Instant::now()));
                        retry.0 = retry.0.saturating_add(1);
                        retry.1 = tokio::time::Instant::now()
                            + Duration::from_secs(1u64 << retry.0.min(5));
                        warn!(%error, room_id = %event.conversation_id, "Discord chat delivery failed; will retry");
                    }
                }
            }
        }
    }
}

async fn deliver(
    config: &Config,
    registry: &Mutex<Registry>,
    http: &Http,
    event: &Outgoing,
) -> BridgeResult<()> {
    let existing = registry
        .lock()
        .await
        .threads
        .get(&event.conversation_id)
        .map(|t| t.id);
    let thread_id = if let Some(id) = existing {
        id
    } else {
        let message = config
            .channel
            .send_message(
                http,
                CreateMessage::new()
                    .embed(
                        CreateEmbed::new()
                            .title(event.room_name.chars().take(256).collect::<String>())
                            .description(format!("Platform chat · {}", event.conversation_id)),
                    )
                    .allowed_mentions(CreateAllowedMentions::new())
                    .nonce(Nonce::String(nonce(&format!(
                        "thread:{}:{}",
                        config.channel, event.conversation_id
                    ))))
                    .enforce_nonce(true),
            )
            .await?;
        let id = ChannelId::new(message.id.get());
        let mut data = registry.lock().await;
        data.threads
            .insert(event.conversation_id.clone(), Thread { id, ready: false });
        data.save(config).await?;
        id
    };
    let ready = registry.lock().await.threads[&event.conversation_id].ready;
    if !ready {
        let exists = thread_id
            .to_channel(http)
            .await
            .ok()
            .and_then(|channel| channel.guild())
            .is_some_and(|channel| {
                channel.parent_id == Some(config.channel) && channel.guild_id == config.guild
            });
        if !exists {
            config
                .channel
                .create_thread_from_message(
                    http,
                    MessageId::new(thread_id.get()),
                    CreateThread::new(
                        event
                            .room_name
                            .clone()
                            .chars()
                            .take(100)
                            .collect::<String>(),
                    ),
                )
                .await?;
        }
        let mut data = registry.lock().await;
        data.threads.get_mut(&event.conversation_id).unwrap().ready = true;
        data.save(config).await?;
    }
    let channel = thread_id
        .to_channel(http)
        .await?
        .guild()
        .ok_or("Discord chat thread no longer exists")?;
    if channel.guild_id != config.guild || channel.parent_id != Some(config.channel) {
        return Err("Discord chat thread moved outside the configured channel".into());
    }
    if channel
        .thread_metadata
        .is_some_and(|metadata| metadata.archived)
    {
        thread_id
            .edit_thread(http, EditThread::new().archived(false))
            .await?;
    }
    thread_id
        .send_message(
            http,
            CreateMessage::new()
                .embed(
                    CreateEmbed::new()
                        .author(CreateEmbedAuthor::new(
                            event.sender.chars().take(256).collect::<String>(),
                        ))
                        .description(&event.content),
                )
                .allowed_mentions(CreateAllowedMentions::new())
                .nonce(Nonce::String(event.nonce.clone()))
                .enforce_nonce(true),
        )
        .await?;
    Ok(())
}

struct Handler {
    state: Arc<ServerState>,
    config: Arc<Config>,
    registry: Arc<Mutex<Registry>>,
}

#[serenity::async_trait]
impl EventHandler for Handler {
    async fn message(&self, ctx: Context, message: Message) {
        if message.author.bot
            || !matches!(
                message.kind,
                MessageType::Regular | MessageType::InlineReply
            )
            || message.webhook_id.is_some()
            || message.guild_id != Some(self.config.guild)
            || !message.member.as_ref().is_some_and(|member| {
                member
                    .roles
                    .iter()
                    .any(|role| self.config.roles.contains(role))
            })
        {
            return;
        }
        let mut data = self.registry.lock().await;
        if data.received.contains(&message.id) {
            return;
        }
        let Some(conversation_id) = data
            .threads
            .iter()
            .find(|(_, thread)| thread.ready && thread.id == message.channel_id)
            .map(|(room, _)| room.clone())
        else {
            return;
        };
        remember(&mut data.received, message.id);
        if let Err(error) = data.save(&self.config).await {
            data.received.retain(|id| *id != message.id);
            warn!(%error, "Discord reply could not be recorded; not delivered");
            return;
        }
        drop(data);
        let content = message.content.trim();
        if content.is_empty() {
            return;
        }
        let room_id = conversation_id.strip_prefix("room:").map(str::to_string);
        let scope = if room_id.is_some() {
            ChatScope::Room
        } else {
            ChatScope::Lobby
        };
        for content in split_message(content) {
            let result = publish_chat(
                &self.state,
                ChatMessage {
                    scope,
                    room_id: room_id.clone(),
                    from: "Admin".into(),
                    avatar_url: None,
                    qualification: Some("maintainer".into()),
                    text: content,
                    sent_at_ms: unix_time_ms(),
                    seal: None,
                },
            );
            if let Err(error) = result {
                warn!(%error, %conversation_id, "Discord admin reply not delivered");
                if let Err(error) = message
                    .channel_id
                    .send_message(
                        &ctx.http,
                        CreateMessage::new()
                            .content("Reply not delivered: this table no longer exists.")
                            .allowed_mentions(CreateAllowedMentions::new()),
                    )
                    .await
                {
                    warn!(%error, "Discord reply delivery notice failed");
                }
                return;
            }
        }
        info!(%conversation_id, discord_user_id = %message.author.id, discord_message_id = %message.id,
            "Discord admin reply delivered");
    }
}

fn nonce(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))[..25].to_string()
}

fn remember<T>(seen: &mut VecDeque<T>, value: T) {
    seen.push_back(value);
    while seen.len() > SEEN_CAPACITY {
        seen.pop_front();
    }
}

fn split_message(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut chunk = String::new();
    let mut length = 0;
    for character in text.chars() {
        if length + 1 > CHAT_MESSAGE_MAX_CHARS {
            chunks.push(std::mem::take(&mut chunk));
            length = 0;
        }
        chunk.push(character);
        length += 1;
    }
    if !chunk.is_empty() {
        chunks.push(chunk);
    }
    chunks
}
