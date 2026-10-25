use std::collections::HashMap;
use std::fs;
use std::fmt::Write as _;
use std::path::Path;
use anyhow::{Context as _, Result, bail};
use chrono::{DateTime, Timelike, Utc};
use serde_json::json;
// use reqwest;

#[derive(Debug)]
enum MessageKind {
    System{
        content: String,
    },
    User{
        content: String,
    },
    ToolCall{
        // tool call id
        id: String,
        // function name
        name: String,
        // string for now
        parameters: String,
        // model, time, headers, finish reason, system fingerprint, etc.
        response_metadata: HashMap<String, String>,
    },
    ToolResult{
        // tool call id
        id: String,
        content: String,
        // log or additional information not send as content
        execution_metadata: HashMap<String, String>,
    },
    Assistant{
        content: String,
        reasoning_content: Option<String>,
        response_metadata: HashMap<String, String>,
    },
}

#[derive(Debug)]
struct Message {
    id: usize,
    // 0 for message#1 I guess
    parent_id: usize,
    create_time: DateTime<Utc>,
    kind: MessageKind,
}

mod template {
    use std::sync::LazyLock;
    use regex::Regex;
    pub const SYSTEM: &str = "🚀SYSTEM";
    pub const USER: &str = "🙋USER";
    pub const ASSISTANT: &str = "🤖ASSISTANT";
    pub const TOOL_CALL: &str = "🤖TOOL-CALL";
    pub const TOOL_RESULT: &str = "🕵🏻TOOL-RESULT";
    pub static HEADERS: &[&str] = &[SYSTEM, USER, ASSISTANT, TOOL_CALL, TOOL_RESULT];
    pub const CONTENT: &str = "💬CONTENT:";
    pub const REASONING_CONTENT: &str = "💭REASONING-CONTENT:";
    pub const METADATA: &str = "🔗METADATA:";
    pub static RE_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#(\d+)(?:<#(\d+))?:$").unwrap());
}

fn read_session(original_content: &str) -> Result<Vec<Message>> {

    #[derive(PartialEq, Eq)]
    enum State {
        // initial or after metadata, expect message header
        Initial,
        AfterMessageHeader,
        InContent{ reasoning: bool },
        InMetadata,
    }
    let mut state = State::Initial;
    let mut messages = Vec::new();
    let mut current_message = Message{ id: 0, parent_id: 0, create_time: Utc::now(), kind: MessageKind::System { content: String::new() } };

    for (line_index, line) in original_content.lines().enumerate() {
        let row_number = line_index + 1;
        // println!("begin loop, {}, {}, {}", row_number, state, line);
        match state {
            State::Initial => {
                if line.trim().is_empty() {
                    continue; // ignore empty lines outside message
                } else if let Some(match_index) =
                    template::HEADERS.iter().position(|h| line.starts_with(*h) && line.ends_with(':'))
                {
                    let header = template::HEADERS[match_index];
                    let Some(captures) = template::RE_ID.captures(line[header.len()..].trim()) else {
                        bail!("row {} expect message header and id", row_number);
                    };
                    // unwrap#1: an always capturing group, unwrap#2: \d+ nearly always parse
                    current_message.id = captures.get(1).unwrap().as_str().parse().unwrap();
                    if let Some(capture) = captures.get(2) {
                        // unwrap: \d+ nearly always parse
                        current_message.parent_id = capture.as_str().parse().unwrap();
                    }
                    match match_index {
                        0 => {}, // same as default value
                        1 => current_message.kind = MessageKind::User{ content: String::new() },
                        2 => current_message.kind = MessageKind::Assistant {
                            content: String::new(),
                            reasoning_content: None,
                            response_metadata: HashMap::new(),
                        },
                        3 => current_message.kind = MessageKind::ToolCall {
                            id: String::new(),
                            name: String::new(),
                            parameters: String::new(),
                            response_metadata: HashMap::new(),
                        },
                        4 => current_message.kind = MessageKind::ToolResult {
                            id: String::new(),
                            content: String::new(),
                            execution_metadata: HashMap::new(),
                        },
                        _ => unreachable!("match_index"),
                    }
                    state = State::AfterMessageHeader;
                } else {
                    bail!("row {} expect message header", row_number);
                }
            },
            State::AfterMessageHeader => {
                match line.trim() {
                    template::CONTENT => state = State::InContent{ reasoning: false },
                    template::REASONING_CONTENT if matches!(current_message.kind, MessageKind::Assistant{..}) => state = State::InContent{ reasoning: true },
                    template::METADATA => state = State::InMetadata,
                    _ => bail!("row {} unexpected format after message header", row_number),
                }
            },
            State::InContent{ reasoning } => {
                if line == template::CONTENT && reasoning {
                    state = State::InContent { reasoning: false };
                } else if line == template::REASONING_CONTENT && !reasoning && matches!(current_message.kind, MessageKind::Assistant{..}) {
                    state = State::InContent { reasoning: true };
                } else if line == template::METADATA {
                    state = State::InMetadata;
                } else if reasoning {
                    let MessageKind::Assistant{ reasoning_content, .. } = &mut current_message.kind else {
                        unreachable!("non assistant in reasoning");
                    };
                    if let Some(reasoning_content) = reasoning_content {
                        reasoning_content.push_str(line);
                        reasoning_content.push('\n');
                    } else {
                        let mut b = line.to_string();
                        b.push('\n');
                        *reasoning_content = Some(b);
                    }
                } else /* not reasoning normal content */ {
                    match &mut current_message.kind {
                        MessageKind::System{ content }
                        | MessageKind::User{ content }
                        | MessageKind::Assistant{ content, .. }
                        | MessageKind::ToolResult{ content, .. } => { content.push_str(line); content.push('\n'); },
                        MessageKind::ToolCall { name, parameters, .. } => {
                            let Some(left_paren_index) = line.find('(') else {
                                bail!("row {} function call content unexpected format", row_number);
                            };
                            if !line.ends_with(')') {
                                bail!("row {} function call content unexpected format (2)", row_number);
                            }
                            *name = line[..left_paren_index].to_string();
                            *parameters = line[left_paren_index + 1..line.len() - 1].to_string();
                        },
                    }
                }
            },
            State::InMetadata => {
                for mut segment in line.split(',') {
                    segment = segment.trim();
                    if let Some(value) = segment.strip_prefix("time:") {
                        current_message.create_time = value.trim().parse().with_context(|| format!("row {} date parse", row_number))?;
                    } else {
                        match &mut current_message.kind {
                            MessageKind::System{..} | MessageKind::User{..} => {
                                bail!("row {} unexpected metadata {}", row_number, segment);
                            },
                            MessageKind::Assistant{ response_metadata, .. } => {
                                if let Some(value) = segment.strip_prefix("complete-time:") {
                                    response_metadata.insert("copmlete-time".to_string(), value.trim().to_string());
                                } else if let Some(value) = segment.strip_prefix("usage:") {
                                    response_metadata.insert("usage".to_string(), value.trim().to_string());
                                } else if let Some(value) = segment.strip_prefix("model:") {
                                    response_metadata.insert("model".to_string(), value.trim().to_string());
                                } else {
                                    bail!("row {} assistant message unknown metadata {}", row_number, segment);
                                }
                            },
                            MessageKind::ToolCall{ id, response_metadata, .. } => {
                                if let Some(value) = segment.strip_prefix("id:") {
                                    *id = value.trim().to_string();
                                } else if let Some(value) = segment.strip_prefix("complete-time:") {
                                    response_metadata.insert("copmlete-time".to_string(), value.trim().to_string());
                                } else if let Some(value) = segment.strip_prefix("usage:") {
                                    response_metadata.insert("usage".to_string(), value.trim().to_string());
                                } else if let Some(value) = segment.strip_prefix("model:") {
                                    response_metadata.insert("model".to_string(), value.trim().to_string());
                                } else {
                                    bail!("row {} tool-call message unknown metadata {}", row_number, segment);
                                }
                            },
                            MessageKind::ToolResult{ id, .. } => {
                                if let Some(value) = segment.strip_prefix("id:") {
                                    *id = value.trim().to_string();
                                } else {
                                    bail!("row {} tool-result message unknown metadata {}", row_number, segment);
                                }
                            },
                        }
                    }
                }
                match &mut current_message.kind {
                    MessageKind::ToolCall{..} => {},
                    MessageKind::System{ content }
                    | MessageKind::User{ content }
                    | MessageKind::ToolResult{ content, .. } => { *content = content.trim().to_string() },
                    MessageKind::Assistant{ content, reasoning_content, .. } => {
                        *content = content.trim().to_string();
                        if let Some(reasoning_content) = reasoning_content {
                            *reasoning_content = reasoning_content.trim().to_string();
                        }
                    },
                }
                messages.push(current_message);
                current_message = Message{ id: 0, parent_id: 0, create_time: Utc::now(), kind: MessageKind::System { content: String::new() } };
                state = State::Initial;
            }
        }
    }
    Ok(messages)
}

fn write_session(filename: impl AsRef<Path>, session: &[Message]) -> Result<()> {

    let mut b = String::new();
    for message in session {
        b.push_str(match message.kind {
            MessageKind::System{..} => template::SYSTEM,
            MessageKind::User{..} => template::USER,
            MessageKind::Assistant{..} => template::ASSISTANT,
            MessageKind::ToolCall{..} => template::TOOL_CALL,
            MessageKind::ToolResult{..} => template::TOOL_RESULT,
        });
        write!(b, " #{}", message.id)?;
        if message.parent_id != 0 {
            write!(b, "<#{}", message.parent_id)?;
        }
        b.push_str(":\n");
        if let MessageKind::Assistant{ reasoning_content: Some(reasoning_content), .. } = &message.kind {
            b.push_str(template::REASONING_CONTENT);
            b.push('\n');
            b.push_str(reasoning_content);
            if !b.ends_with('\n') { b.push('\n'); }
        }
        match &message.kind {
            | MessageKind::System{ content }
            | MessageKind::User{ content }
            | MessageKind::Assistant{ content, .. }
            | MessageKind::ToolResult{ content, .. } => {
                b.push_str(template::CONTENT);
                b.push('\n');
                b.push_str(&content);
                if !b.ends_with('\n') { b.push('\n'); }
            }
            MessageKind::ToolCall{ name, parameters, .. } => {
                b.push_str(template::CONTENT);
                b.push('\n');
                b.push_str(name);
                b.push('(');
                b.push_str(parameters);
                b.push_str(")\n");
            },
        }
        b.push_str(template::METADATA);
        b.push('\n');
        // why is this specific format the impl debug
        write!(b, "time: {:?}", message.create_time)?;
        if let MessageKind::ToolCall { id, .. } | MessageKind::ToolResult { id, .. } = &message.kind {
            write!(b, ", id: {}", id)?;
        }
        if let
            | MessageKind::Assistant { response_metadata: metadata, .. }
            | MessageKind::ToolCall { response_metadata: metadata, .. }
            | MessageKind::ToolResult { execution_metadata: metadata, .. } = &message.kind
        {
            for (key, value) in metadata {
                write!(b, ", {}: {}", key, value)?;
            }
        }
        b.push_str("\n\n");
    }
    fs::write(filename, b)?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    
    let session_data = fs::read_to_string("example2.txt")?;
    let mut session = read_session(&session_data)?;
    println!("{:?}", session);

    // let client = reqwest::Client::builder().build()?;
    // let request = client
    //     .post("https://api.deepseek.com/chat/completions")
    //     .header("content-type", "application/json")
    //     .bearer_auth(api_key)
    //     .body(json!({
    //         "model": "deepseek-flash",
    //         "messages": messages,
    //         "stream": true
    //     }).to_string())
    //     .build()?;
    // let response = client.execute(request).await?;
    // println!("status {} headers {:?}", response.status(), response.headers());
    // let response_text = response.text().await?;
    // println!("response {}", response_text);
    // seems need use response.bytes_stream

    let result_message = Message {
        id: 43,
        parent_id: 42,
        create_time: Utc::now().with_nanosecond(0).unwrap(),
        kind: MessageKind::Assistant {
            content: "this file contains...".to_string(),
            reasoning_content: Some("now I need to...".to_string()),
            response_metadata: {
                let mut map = HashMap::new();
                map.insert("time".to_string(), "30".to_string());
                map.insert("model".to_string(), "deepseekv5".to_string());
                map.insert("usage".to_string(), "100/200/300".to_string());
                map.insert("system-fingerprint".to_string(), "system-fingerprint".to_string());
                map
            },
        },
    };
    session.push(result_message);
    write_session("example2-1.txt", &session)?;

    Ok(())
}
