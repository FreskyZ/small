use std::{fs, path::Path};
use std::sync::LazyLock;
use anyhow::{Context as _, Result, bail};
use chrono::{DateTime, Utc};
use regex::Regex;
// use reqwest;

#[derive(Debug, Default)]
enum Role {
    #[default]
    System,
    User,
    Assistant,
}
#[derive(Debug, Default)]
struct Message {
    id: usize,
    // 0 for message#1 I guess
    parent_id: usize,
    role: Role,
    reasoning_content: Option<String>,
    content: String,
    // user message's create time, assistant message's first response time I guess
    create_time: DateTime<Utc>,
    // assistant message's complete time
    complete_time: Option<DateTime<Utc>>,
    // input, output hit, output miss
    usage: Option<(usize, usize, usize)>,
    model: Option<String>,
    fingerprint: Option<String>,
}

fn parse_text_representation(original_content: &str) -> Result<Vec<Message>> {

    static RE_SYSTEM_HEADER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^SYSTEM #(\d+):$").unwrap());
    static RE_USER_HEADER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^USER #(\d+)<-#(\d+):$").unwrap());
    static RE_ASSISTANT_HEADER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^ASSISTANT #(\d+)<-#(\d+):$").unwrap());

    // initial | in-message | in-content | in-reasoning-content | in-metadata
    let mut state = "initial";
    let mut current_message = Message::default();
    let mut messages = Vec::new();
    for (line_index, line) in original_content.lines().enumerate() {
        // println!("begin loop, {}, {}, {}", line_index, state, line);
        if state == "initial" {
            if line.trim().is_empty() || line.starts_with("#") {
                // ignore comment outside message body
            } else if let Some(captures) = RE_SYSTEM_HEADER.captures(line) {
                if current_message.id != 0 {
                    bail!("line {} unexpected incomplete message when meet message header? {:?}", line_index + 1, current_message);
                }
                current_message.id = captures.get(1).unwrap().as_str().parse().with_context(|| line_index)?;
                state = "in-message";
            } else if let Some(captures) = RE_USER_HEADER.captures(line) {
                if current_message.id != 0 {
                    bail!("line {} unexpected incomplete message when meet message header? {:?}", line_index + 1, current_message);
                }
                current_message.id = captures.get(1).unwrap().as_str().parse()?;
                current_message.parent_id = captures.get(2).unwrap().as_str().parse().with_context(|| line_index)?;
                current_message.role = Role::User;
                state = "in-message";
            } else if let Some(captures) = RE_ASSISTANT_HEADER.captures(line) {
                if current_message.id != 0 {
                    bail!("line {} unexpected incomplete message when meet message header? {:?}", line_index + 1, current_message);
                }
                current_message.id = captures.get(1).unwrap().as_str().parse()?;
                current_message.parent_id = captures.get(2).unwrap().as_str().parse().with_context(|| line_index)?;
                current_message.role = Role::Assistant;
                state = "in-message";
            } else {
                bail!("line {} expect system message header", line_index + 1);
            }
        } else if state == "in-message" {
            match line {
                "CONTENT:" => state = "in-content",
                "REASONING-CONTENT:" if matches!(current_message.role, Role::Assistant) => state = "in-reasoning-content",
                "METADATA:" => state = "in-metadata",
                _ => bail!("line {} unexpected format after message header", line_index + 1),
            }
        } else if state == "in-content" {
            if line == "METADATA:" {
                state = "in-metadata";
            } else if line == "REASONING-CONTENT" && matches!(current_message.role, Role::Assistant) {
                state = "in-reasoning-content";
            } else if line.starts_with("escape") && line.ends_with("epacse") {
                current_message.content.push_str(&line[6..line.len() - 6]);
                current_message.content.push('\n');
            } else {
                current_message.content.push_str(line);
                current_message.content.push('\n');
            }
        } else if state == "in-reasoning-content" {
            if line == "METADATA:" {
                state = "in-metadata";
            } else if line == "CONTENT:" {
                state = "in-content";
            } else if line.starts_with("escape") && line.ends_with("epacse") {
                if let Some(reasoning_content) = &mut current_message.reasoning_content {
                    reasoning_content.push_str(&line[6..line.len() - 6]);
                    reasoning_content.push('\n');
                } else {
                    let mut reasoning_content = line[6..line.len() - 6].to_string();
                    reasoning_content.push('\n');
                    current_message.reasoning_content = Some(reasoning_content);
                }
            } else {
                if let Some(reasoning_content) = &mut current_message.reasoning_content {
                    reasoning_content.push_str(line);
                    reasoning_content.push('\n');
                } else {
                    let mut reasoning_content = line.to_string();
                    reasoning_content.push('\n');
                    current_message.reasoning_content = Some(reasoning_content);
                }
            }
        } else if state == "in-metadata" {
            match current_message.role {
                Role::System => {
                    // no metadata yet
                    current_message.content = current_message.content.trim().to_string();
                    messages.push(current_message);
                    current_message = Message::default();
                },
                Role::User => {
                    for mut part in line.split(',') {
                        part = part.trim();
                        if let Some(part) = part.strip_prefix("time:") {
                            current_message.create_time = part.trim().parse().with_context(|| line_index)?;
                        } else {
                            bail!("line {} user message unknown metadata {}", line_index + 1, line);
                        }
                    }
                    current_message.content = current_message.content.trim().to_string();
                    messages.push(current_message);
                    current_message = Message::default();
                },
                Role::Assistant => {
                    for mut part in line.split(',') {
                        part = part.trim();
                        if part.starts_with("time:") {
                            current_message.create_time = part[5..].trim().parse().with_context(|| line_index)?;
                        } else if let Some(part) = part.strip_prefix("complete-time:") {
                            current_message.complete_time = Some(part.trim().parse().with_context(|| line_index)?);
                        } else if let Some(part) = part.strip_prefix("usage:") {
                            let mut usage = Vec::new();
                            for value in part.split('/') {
                                usage.push(value.trim().parse().with_context(|| format!("{}, {}, {}", line_index, part, value))?);
                            }
                            if usage.len() != 3 {
                                bail!("line {} usage unexpected format? {}", line_index, line);
                            }
                            current_message.usage = Some((usage[0], usage[1], usage[2]));
                        } else if let Some(part) = part.strip_prefix("model:") {
                            current_message.model = Some(part.trim().to_string());
                        } else if let Some(part) = part.strip_prefix("fingerprint:") {
                            current_message.fingerprint = Some(part.trim().to_string());
                        } else {
                            bail!("line {} assistant message unknown metadata {}", line_index + 1, line);
                        }
                    }
                    current_message.content = current_message.content.trim().to_string();
                    if let Some(reasoning_content) = current_message.reasoning_content {
                        current_message.reasoning_content = Some(reasoning_content.trim().to_string());
                    }
                    messages.push(current_message);
                    current_message = Message::default();
                },
            }
            state = "initial";
        }
    }
    Ok(messages)
}

fn save_text_representation(filename: impl AsRef<Path>, session: &[Message]) -> Result<()> {

    let mut b = String::new();
    for message in session {
        match message.role {
            Role::System => b.push_str("SYSTEM"),
            Role::User => b.push_str("USER"),
            Role::Assistant => b.push_str("ASSISTANT"),
        }
    }
    fs::write(filename, b)?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {

    let Ok(_) = std::env::var("TAIGA_API_KEY") else {
        bail!("env var TAIGA_API_KEY missing");
    };
    let original_content = fs::read_to_string("example2.txt")?;
    let mut session = parse_text_representation(&original_content)?;
    println!("{:?}", session);

    // let client = reqwest::Client::builder().build()?;
    // let request = client
    //     .get("https://api.deepseek.com/user/balance")
    //     .header("content-type", "application/json")
    //     .bearer_auth(api_key)
    //     .build()?;
    // let response = client.execute(request).await?;
    // println!("status {} headers {:?}", response.status(), response.headers());
    // let response_text = response.text().await?;
    // println!("response {}", response_text);
    // seems need use response.bytes_stream

    let result_message = Message {
        id: 3,
        parent_id: 2,
        role: Role::Assistant,
        reasoning_content: None,
        content: "tool call?".to_string(),
        create_time: Utc::now(),
        complete_time: Some(Utc::now()),
        usage: Some((100, 100, 100)),
        model: Some("deepseek-flash".to_string()),
        fingerprint: Some("fingerprintvalue".to_string()),
    };
    session.push(result_message);
    save_text_representation("example2-1.txt", &session)?;

    Ok(())
}
