use std::collections::{BinaryHeap, HashMap};
use std::fs;
use std::fmt::Write as _;
use anyhow::{Context as _, Result, bail};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde_json::json;
use reqwest;

#[cfg(test)]
use std::assert_matches;
#[cfg(test)]
use chrono::TimeZone as _;

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
    // oh, only when you provide tools in manual api invocation and receive an assistant message with content and tool
    // calls in your lifetime you realize that, content, reasoning content and tool calls will appear in the same message
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
                                    response_metadata.insert("complete-time".to_string(), value.trim().to_string());
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
                                    response_metadata.insert("complete-time".to_string(), value.trim().to_string());
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

fn format_session(session: &[Message]) -> Result<String> {

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
            for (key, value) in metadata.iter().collect::<BinaryHeap<_>>().into_sorted_vec() {
                write!(b, ", {}: {}", key, value)?;
            }
        }
        b.push_str("\n\n");
    }
    Ok(b)
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

    Ok(())
}

#[test]
fn test_read() -> Result<()> {
    let session = read_session(concat!(
        "🚀SYSTEM #1:\n",
        "💬CONTENT:\n",
        "You are a coding agent.\n",
        "🔗METADATA:\n",
        "time: 2026-10-22T15:13:00Z\n\n",
        "🙋USER #2<#1:\n",
        "💬CONTENT:\n",
        "summary source code file src/main.rs\n",
        "🔗METADATA:\n",
        "time: 2026-10-22T15:13:01Z\n\n",
        "🤖TOOL-CALL #3<#2:\n",
        "💬CONTENT:\n",
        "read_file({ pathname: \"src/main.rs\" })\n",
        "🔗METADATA:\n",
        "time: 2026-10-23T06:29:00Z, id: toolcallid, usage: 100/100/100, model: deepseek-flash\n\n",
        "🕵🏻TOOL-RESULT #3<#2:\n",
        "💬CONTENT:\n",
        "use std::fs;\n",
        "...\n",
        "struct Message...\n",
        "fn read_session...\n",
        "fn test_read...\n",
        "🔗METADATA:\n",
        "time: 2026-10-23T06:30:00Z, id: toolcallid\n\n",
        "🤖ASSISTANT #5<#42:\n",
        "💭REASONING-CONTENT:\n",
        "why do you need reasoning when reading a small file?\n",
        "💬CONTENT:\n",
        "this file contains...\n",
        "🔗METADATA:\n",
        "time: 2026-10-23T06:29:02Z, complete-time: 30, usage:42/325/799, model: deepseek-flasher\n\n",
    ))?;
    assert_eq!(session.len(), 5);
    assert_eq!(session[0].id, 1);
    assert_eq!(session[0].parent_id, 0);
    assert_eq!(session[0].create_time, Utc.with_ymd_and_hms(2026, 10, 22, 15, 13, 0).unwrap());
    assert_matches!(&session[0].kind, MessageKind::System{ content } if content == "You are a coding agent.");
    assert_eq!(session[1].id, 2);
    assert_eq!(session[1].parent_id, 1);
    assert_eq!(session[1].create_time, Utc.with_ymd_and_hms(2026, 10, 22, 15, 13, 1).unwrap());
    assert_matches!(&session[1].kind, MessageKind::User{ content } if content == "summary source code file src/main.rs");
    assert_eq!(session[2].id, 3);
    assert_eq!(session[2].parent_id, 2);
    assert_eq!(session[2].create_time, Utc.with_ymd_and_hms(2026, 10, 23, 6, 29, 0).unwrap());
    let MessageKind::ToolCall{ id, name, parameters, response_metadata } = &session[2].kind else {
        panic!("session[2].kind not toolcall");
    };
    assert_eq!(id, "toolcallid");
    assert_eq!(name, "read_file");
    assert_eq!(parameters, "{ pathname: \"src/main.rs\" }");
    assert_eq!(response_metadata.len(), 2);
    assert_eq!(response_metadata["usage"], "100/100/100");
    assert_eq!(response_metadata["model"], "deepseek-flash");
    // does not validate id
    assert_eq!(session[3].id, 3);
    assert_eq!(session[3].parent_id, 2);
    assert_eq!(session[3].create_time, Utc.with_ymd_and_hms(2026, 10, 23, 6, 30, 0).unwrap());
    let MessageKind::ToolResult{ id, content, execution_metadata } = &session[3].kind else {
        panic!("session[3].kind not toolresult");
    };
    assert_eq!(id, "toolcallid");
    assert_eq!(content, "use std::fs;\n...\nstruct Message...\nfn read_session...\nfn test_read...");
    assert_eq!(execution_metadata.len(), 0);
    assert_eq!(session[4].id, 5);
    // does not validate id
    assert_eq!(session[4].parent_id, 42);
    assert_eq!(session[4].create_time, Utc.with_ymd_and_hms(2026, 10, 23, 6, 29, 2).unwrap());
    let MessageKind::Assistant{ reasoning_content, content, response_metadata } = &session[4].kind else {
        panic!("session[4].kind not assistant");
    };
    assert_eq!(reasoning_content.as_deref(), Some("why do you need reasoning when reading a small file?"));
    assert_eq!(content, "this file contains...");
    assert_eq!(response_metadata.len(), 3);
    assert_eq!(response_metadata["complete-time"], "30");
    assert_eq!(response_metadata["usage"], "42/325/799");
    assert_eq!(response_metadata["model"], "deepseek-flasher");

    Ok(())
}

#[test]
fn test_read_no_system() -> Result<()> {

    let session = read_session(concat!(
        "🙋USER #1:\n",
        "💬CONTENT:\n",
        "hello\n",
        "🔗METADATA:\n",
        "time: 2026-10-25T07:57:00Z",
    ))?;
    assert_eq!(session.len(), 1);
    assert_eq!(session[0].id, 1);
    assert_eq!(session[0].parent_id, 0);
    assert_eq!(session[0].create_time, Utc.with_ymd_and_hms(2026, 10, 25, 7, 57, 0).unwrap());
    assert_matches!(&session[0].kind, MessageKind::User{ content } if content == "hello");

    // does not validate first message shouldn't have parent id
    let session = read_session(concat!(
        "🙋USER #1<#33554432:\n",
        "💬CONTENT:\n",
        "hello\n",
        "🔗METADATA:\n",
        "time: 2026-10-25T07:57:00Z",
    ))?;
    assert_eq!(session.len(), 1);
    assert_eq!(session[0].id, 1);
    assert_eq!(session[0].parent_id, 33554432);
    assert_eq!(session[0].create_time, Utc.with_ymd_and_hms(2026, 10, 25, 7, 57, 0).unwrap());
    assert_matches!(&session[0].kind, MessageKind::User{ content } if content == "hello");
    
    // does not validate first message is system or user
    let session = read_session(concat!(
        "🕵🏻TOOL-RESULT #3<#2:\n",
        "💬CONTENT:\n",
        "use std::fs;\n",
        "🔗METADATA:\n",
        "time: 2026-10-23T06:30:00Z, id: toolcallid\n\n",
    ))?;
    assert_eq!(session[0].id, 3);
    assert_eq!(session[0].parent_id, 2);
    assert_eq!(session[0].create_time, Utc.with_ymd_and_hms(2026, 10, 23, 6, 30, 0).unwrap());
    let MessageKind::ToolResult{ id, content, execution_metadata } = &session[0].kind else {
        panic!("session[0].kind not toolresult");
    };
    assert_eq!(id, "toolcallid");
    assert_eq!(content, "use std::fs;");
    assert_eq!(execution_metadata.len(), 0);

    Ok(())
}

#[test]
fn test_read_escape() -> Result<()> {

    // does not have escape mechanism
    // oh, cannot transition to in-content state from in-content state?
    let session = read_session(concat!(
        "🙋USER #1:\n",
        "💬CONTENT:\n",
        "💬CONTENT:\n",
        "💬CONTENT:\n",
        "🔗METADATA:\n",
        "time: 2026-10-25T07:57:00Z",
    ))?;
    assert_eq!(session.len(), 1);
    assert_eq!(session[0].id, 1);
    assert_eq!(session[0].parent_id, 0);
    assert_eq!(session[0].create_time, Utc.with_ymd_and_hms(2026, 10, 25, 7, 57, 0).unwrap());
    assert_matches!(&session[0].kind, MessageKind::User{ content } if content == "💬CONTENT:\n💬CONTENT:");

    let session = read_session(concat!(
        "🤖ASSISTANT #1:\n",
        "💬CONTENT:\n",
        "💭REASONING-CONTENT:\n",
        "💬CONTENT:\n",
        "💭REASONING-CONTENT:\n",
        "🔗METADATA:\n",
        "time: 2026-10-25T08:04:00Z",
    ))?;
    assert_eq!(session.len(), 1);
    assert_eq!(session[0].id, 1);
    assert_eq!(session[0].parent_id, 0);
    assert_eq!(session[0].create_time, Utc.with_ymd_and_hms(2026, 10, 25, 8, 4, 0).unwrap());
    assert_matches!(&session[0].kind, MessageKind::Assistant{ content, reasoning_content, .. } if content == "" && reasoning_content.is_none());

    Ok(())
}

#[test]
fn test_write() -> Result<()> {

    assert_eq!(format_session(&[
        Message {
            id: 1,
            parent_id: 0,
            create_time: Utc.with_ymd_and_hms(2026, 10, 22, 15, 13, 0).unwrap(),
            kind: MessageKind::System { content: "You are a coding agent.".to_string() },
        },
        Message {
            id: 2,
            parent_id: 1,
            create_time: Utc.with_ymd_and_hms(2026, 10, 22, 15, 13, 1).unwrap(),
            kind: MessageKind::User { content: "summary source code file src/main.rs".to_string() },
        },
        Message {
            id: 3,
            parent_id: 2,
            create_time: Utc.with_ymd_and_hms(2026, 10, 23, 6, 29, 0).unwrap(),
            kind: MessageKind::ToolCall {
                id: "tool-call-id".to_string(),
                name: "read_file".to_string(),
                parameters: "{ pathname: \"src/main.rs\" }".to_string(),
                response_metadata: {
                    let mut map = HashMap::new();
                    map.insert("model".to_string(), "deepseek-flash".to_string());
                    map.insert("usage".to_string(), "100/100/100".to_string());
                    map
                },
            },
        },
        Message {
            id: 3,
            parent_id: 2,
            create_time: Utc.with_ymd_and_hms(2026, 10, 23, 6, 30, 0).unwrap(),
            kind: MessageKind::ToolResult {
                // does not validate tool call id
                id: "not-tool-call-id".to_string(),
                content: "use std::fs;\n...\nstruct Message...\nfn read_session...\nfn test_read...".to_string(),
                execution_metadata: HashMap::new(),
            },
        },
        Message {
            id: 5,
            parent_id: 42,
            create_time: Utc.with_ymd_and_hms(2026, 10, 23, 6, 29, 2).unwrap(),
            kind: MessageKind::Assistant {
                content: "this file contains...".to_string(),
                reasoning_content: Some("why do you need reasoning when reading a small file?".to_string()),
                response_metadata: {
                    let mut map = HashMap::new();
                    map.insert("complete-time".to_string(), "30".to_string());
                    map.insert("model".to_string(), "deepseek-flasher".to_string());
                    map.insert("usage".to_string(), "42/325/799".to_string());
                    map.insert("system-fingerprint".to_string(), "system-fingerprint".to_string());
                    map
                },
            },
        },
    ])?, concat!(
        "🚀SYSTEM #1:\n",
        "💬CONTENT:\n",
        "You are a coding agent.\n",
        "🔗METADATA:\n",
        "time: 2026-10-22T15:13:00Z\n\n",
        "🙋USER #2<#1:\n",
        "💬CONTENT:\n",
        "summary source code file src/main.rs\n",
        "🔗METADATA:\n",
        "time: 2026-10-22T15:13:01Z\n\n",
        "🤖TOOL-CALL #3<#2:\n",
        "💬CONTENT:\n",
        "read_file({ pathname: \"src/main.rs\" })\n",
        "🔗METADATA:\n",
        "time: 2026-10-23T06:29:00Z, id: tool-call-id, model: deepseek-flash, usage: 100/100/100\n\n",
        "🕵🏻TOOL-RESULT #3<#2:\n",
        "💬CONTENT:\n",
        "use std::fs;\n",
        "...\n",
        "struct Message...\n",
        "fn read_session...\n",
        "fn test_read...\n",
        "🔗METADATA:\n",
        "time: 2026-10-23T06:30:00Z, id: not-tool-call-id\n\n",
        "🤖ASSISTANT #5<#42:\n",
        "💭REASONING-CONTENT:\n",
        "why do you need reasoning when reading a small file?\n",
        "💬CONTENT:\n",
        "this file contains...\n",
        "🔗METADATA:\n",
        "time: 2026-10-23T06:29:02Z, complete-time: 30, model: deepseek-flasher, system-fingerprint: system-fingerprint, usage: 42/325/799\n\n",
    ));
    Ok(())
}
