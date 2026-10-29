use std::fs;
use anyhow::{Context as _, Result, bail};
use chrono::{DateTime, Timelike, Utc};
use futures_util::StreamExt;
use serde_json::json;
use serde_yaml_ng::from_str as yaml_parse;
use reqwest;

#[derive(Debug)]
enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug)]
struct TextBlock {
    value: String,
}

// this content block design come from a/ messages api,
// a user message can contain multiple tool result blocks,
// while that's multiple role=tool messages for chat completion api,
// use this design for in memory data structure because it's more clear
#[derive(Debug)]
struct ToolResultBlock {
    id: String,
    value: String,
    // tool execution information
    metadata: Vec<(String, serde_yaml_ng::Value)>,
}

#[derive(Debug)]
struct ToolCallBlock {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Debug)]
enum ContentBlock {
    // system, user, assistant, tool result content
    Content(TextBlock),
    Reasoning(TextBlock),
    ToolResult(ToolResultBlock),
    ToolCall(ToolCallBlock),
}

#[derive(Debug)]
struct Message {
    id: usize,
    parent_id: usize,
    role: Role,
    content: Vec<ContentBlock>,
    // web response additional information
    response_metadata: Vec<(String, serde_yaml_ng::Value)>,
}

#[derive(Debug)]
struct Session {
    name: String,
    // store messages tree structure as flat nodes and record tree structure in id and parent id
    messages: Vec<Message>,
}

fn read_session(original_content: &str) -> Result<Session> {
    use serde_yaml_ng::Value as Node;

    let document: Node = yaml_parse(original_content)?;
    // println!("{:?}", document);
    let Node::Mapping(mut document) = document else { bail!("top level not mapping?") };

    let Node::String(session_name) = document.shift_remove("name")
        .unwrap_or_else(|| Node::String("session name".to_string())) else
    {
        bail!("session name not string?");
    };
    let mut session = Session{
        name: session_name,
        messages: Vec::new(),
    };

    for (key, value) in document {
        let Node::String(key) = key else {
            bail!("oh very cool non-plain mapping key");
        };
        if matches!(key.as_str(), "create-time") {
            continue;
        }
        let Some(message_id) = key.strip_prefix("message-") else {
            bail!("unknown top level property {}", key);
        };
        let message_id: usize = message_id.parse()
            .with_context(|| format!("failed to parse message id in {}", key))?;
        let Node::Mapping(mut message_node) = value else {
            bail!("message#{}: message element not mapping?", message_id);
        };

        let Node::Number(parent_id) = message_node.swap_remove("parent-id").unwrap_or(0.into()) else {
            bail!("message#{}: parent-id not number", message_id);
        };
        let Some(parent_id) = parent_id.as_u64().map(|v| v as usize) else {
            bail!("message#{}: parent-id not positive integer?", message_id);
        };

        let Some(Node::String(role)) = message_node.swap_remove("role") else {
            bail!("message#{}: role missing or is not string", message_id);
        };
        let role = match role.as_str() {
            "system" => Role::System,
            "user" => Role::User,
            "assistant" => Role::Assistant,
            other => bail!("message#{}: unknown role {}", message_id, other),
        };

        let mut message = Message{
            id: message_id,
            parent_id,
            role,
            content: Vec::new(),
            response_metadata: Vec::new(),
        };
        let Some(content_node) = message_node.swap_remove("content") else {
            bail!("message#{}: missing content", message_id);
        };
        if let Node::String(value) = content_node {
            message.content.push(ContentBlock::Content(TextBlock{ value }));
        } else if let Node::Sequence(content_nodes) = content_node {
            for (content_index, content_node) in content_nodes.into_iter().enumerate() {
                let Node::Mapping(mut content_node) = content_node else {
                    bail!("message#{}: content#{}: not mapping?", message_id, content_index);
                };
                let Some(Node::String(kind)) = content_node.swap_remove("kind") else {
                    bail!("message#{}: content#{}: kind missing or is not string", message_id, content_index);
                };
                let content_block;
                match kind.as_str() {
                    "content" => {
                        let Some(Node::String(value)) = content_node.swap_remove("value") else {
                            bail!("message#{}: content#{}: value missing or is not string", message_id, content_index);
                        };
                        content_block = ContentBlock::Content(TextBlock{ value });
                    },
                    "reasoning" => {
                        let Some(Node::String(value)) = content_node.swap_remove("value") else {
                            bail!("message#{}: content#{}: value missing or is not string", message_id, content_index);
                        };
                        content_block = ContentBlock::Reasoning(TextBlock{ value });
                    },
                    "tool-call" => {
                        let Some(Node::String(tool_call_id)) = content_node.swap_remove("id") else {
                            bail!("message#{}: content#{}: id missing or is not string", message_id, content_index);
                        };
                        let Some(Node::String(tool_name)) = content_node.swap_remove("name") else {
                            bail!("message#{}: content#{}: name missing or is not string", message_id, content_index);
                        };
                        let Some(Node::String(arguments)) = content_node.swap_remove("arguments") else {
                            bail!("message#{}: content#{}: arguments missing or is not string", message_id, content_index);
                        };
                        content_block = ContentBlock::ToolCall(ToolCallBlock{ id: tool_call_id, name: tool_name, arguments });
                    },
                    "tool-result" => {
                        let Some(Node::String(tool_call_id)) = content_node.swap_remove("id") else {
                            bail!("message#{}: content#{}: id missing or is not string", message_id, content_index);
                        };
                        let Some(Node::String(value)) = content_node.swap_remove("value") else {
                            bail!("message#{}: content#{}: value missing or is not string", message_id, content_index);
                        };
                        let metadata = Vec::new();
                        // no need to read existing execution metadata
                        content_node.swap_remove("metadata");
                        content_block = ContentBlock::ToolResult(ToolResultBlock{ id: tool_call_id, value, metadata });
                    },
                    other => bail!("message#{}: content#{}: unknown kind {}", message_id, content_index, other),
                }
                if !content_node.is_empty() {
                    bail!("message#{}: content#{}: unknown properties {:?}", message_id, content_index, content_node.keys().collect::<Vec<_>>());
                }
                message.content.push(content_block);
            }
        } else {
            bail!("message#{}: content is not string or sequence?", message_id);
        }
        // no need to read existing response metadata
        message_node.swap_remove("response");
        if !message_node.is_empty() {
            bail!("message#{}: unknown properties {:?}", message_id, message_node.keys().collect::<Vec<_>>());
        }
        session.messages.push(message);
    }

    Ok(session)
}

// only append seems good
fn format_message(message: Message) -> Result<String> {
    use serde_yaml_ng::{Value as Node, Mapping};

    let mut message = message;
    let mut message_node = Mapping::new();
    if message.parent_id != 0 {
        message_node.insert(Node::String("parent-id".to_string()), Node::Number(message.parent_id.into()));
    }
    message_node.insert(Node::String("role".to_string()), Node::String(match message.role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }.to_string()));
    if message.content.len() == 1 && matches!(message.content[0], ContentBlock::Content(_)) {
        let ContentBlock::Content(TextBlock{ value }) = &mut message.content[0] else { unreachable!() };
        message_node.insert(Node::String("content".to_string()), Node::String(std::mem::take(value)));
    } else {
        let mut content_nodes = Vec::new();
        for content_block in message.content {
            let mut content_node = Mapping::new();
            match content_block {
                ContentBlock::Content(TextBlock { value }) => {
                    content_node.insert(Node::String("kind".to_string()), Node::String("content".to_string()));
                    content_node.insert(Node::String("value".to_string()), Node::String(value));
                },
                ContentBlock::Reasoning(TextBlock { value }) => {
                    content_node.insert(Node::String("kind".to_string()), Node::String("reasoning".to_string()));
                    content_node.insert(Node::String("value".to_string()), Node::String(value));
                },
                ContentBlock::ToolCall(ToolCallBlock { id, name, arguments }) => {
                    content_node.insert(Node::String("kind".to_string()), Node::String("tool-call".to_string()));
                    content_node.insert(Node::String("id".to_string()), Node::String(id));
                    content_node.insert(Node::String("name".to_string()), Node::String(name));
                    content_node.insert(Node::String("arguments".to_string()), Node::String(arguments));
                },
                ContentBlock::ToolResult(ToolResultBlock { id, value, metadata }) => {
                    content_node.insert(Node::String("kind".to_string()), Node::String("tool-result".to_string()));
                    content_node.insert(Node::String("id".to_string()), Node::String(id));
                    content_node.insert(Node::String("value".to_string()), Node::String(value));
                    let mut metadata_node = Mapping::new();
                    for (key, value) in metadata {
                        metadata_node.insert(Node::String(key), value);
                    }
                    if !metadata_node.is_empty() {
                        content_node.insert(Node::String("metadata".to_string()), Node::Mapping(metadata_node));
                    }
                },
            }
            content_nodes.push(Node::Mapping(content_node));
        }
        message_node.insert(Node::String("content".to_string()), Node::Sequence(content_nodes));
    }
    if !message.response_metadata.is_empty() {
        let mut response_metadata_node = Mapping::new();
        for (key, value) in message.response_metadata {
            response_metadata_node.insert(Node::String(key), value);
        }
        message_node.insert(Node::String("response".to_string()), Node::Mapping(response_metadata_node));
    }

    let mut new_document = Mapping::new();
    new_document.insert(Node::String(format!("message-{}", message.id)), Node::Mapping(message_node));
    Ok(serde_yaml_ng::to_string(&Node::Mapping(new_document))?)
}

#[tokio::main]
async fn main() -> Result<()> {

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    
    let text = fs::read_to_string("example-input.yml")?;
    let session = read_session(&text)?;
    println!("session name {}", session.name);
    println!("{:?}", session);

    // let formatted = format_session(session)?;
    // fs::write("example-output.yml", formatted)?;

    for message in session.messages {
        println!("{}", format_message(message)?);
    }

    // let messages = session.iter().map(|m| match &m.kind {
    //     MessageKind::System{ content } => json!({ "role": "system", "content": content }),
    //     MessageKind::User{ content } => json!({ "role": "user", "content": content }),
    //     MessageKind::Assistant{ content, .. } => json!({ "role": "user", "content": content }),
    //     MessageKind::ToolResult{ id, content, .. } => json!({ "role": "tool", "tool_call_id": id, "content": content }),
    //     MessageKind::ToolCall{ id, name, parameters, .. } => json!({
    //         "role": "assistant",
    //         // you are ok with this null?
    //         "content": null,
    //         "tool_calls": [
    //             {
    //                 "id": id,
    //                 "type": "function",
    //                 "function": {
    //                     "name": name,
    //                     "arguments": parameters,
    //                 },
    //             }
    //         ],
    //     })
    // }).collect::<Vec<_>>();
    // println!("{:?}", messages);

    // let tools = json!([
    //     {
    //         "type": "function",
    //         "function": {
    //             "name": "read-file",
    //             "description": "Read the contents of a file. Line numbers are 1-indexed. This tool will truncate its output at 2000 lines and may be called repeatedly with offset and limit parameters to read larger files in chunks. Binary files use offset/limit as byte offsets.",
    //             "parameters": {
    //                 "type": "object",
    //                 "properties": {
    //                     "pathname": {
    //                         "type": "string",
    //                         "description": "The path of the file to read.",
    //                     },
    //                     "offset": {
    //                         "type": "number",
    //                         "description": "Optional: the 1-based line number to start reading from. Only use this if the file is too large to read at once. If not specified, the file will be read from the beginning.",
    //                     },
    //                     "limit": {
    //                         "type": "number",
    //                         "description": "Optional: the maximum number of lines to read. Only use this together with `offset` if the file is too large to read at once.",
    //                     }
    //                 },
    //                 "required": ["pathname"],
    //             },
    //         },
    //     },
    // ]);
    // println!("{:?}", tools);

    // let client = reqwest::Client::builder().build()?;
    // let request = client
    //     .post("https://api.deepseek.com/chat/completions")
    //     .header("content-type", "application/json")
    //     .bearer_auth(api_key)
    //     .body(json!({
    //         "model": "deepseek-flash",
    //         "messages": messages,
    //         "tools": tools,
    //         "thinking": { "type": "disabled" },
    //         "stream": true,
    //         "max_tokens": 1024,
    //     }).to_string()).build()?;
    // let response = client.execute(request).await?;

    // let status = response.status();
    // if !status.is_success() {
    //     let body = response.text().await?;
    //     bail!("response error {}: {}", status, body);
    // }
    // for (name, value) in response.headers() {
    //     println!("header {}: {:?}", name, value);
    // }

    // let mut stream = response.bytes_stream();
    // while let Some(chunk) = stream.next().await {
    //     let chunk = chunk?;
    //     let chunk = String::from_utf8_lossy(&chunk);
    //     println!("chunk: {}", chunk);
    // }

    Ok(())
}

#[test]
fn test_read() -> Result<()> {
    use std::assert_matches;

    let session = read_session(concat!(
        "name: session name\n",
        "create-time: 2026-10-22T07:59:00Z\n",
        "\n",
        "message-1:\n",
        "  role: system\n",
        "  content: You are a coding agent\n",
        "\n",
        "message-2:\n",
        "  parent-id: 1\n",
        "  role: user\n",
        "  content:\n",
        "    summary source code file src/main.rs\n",
        "\n",
        "message-3:\n",
        "  parent-id: 2\n",
        "  role: assistant\n",
        "  content:\n",
        "  - kind: reasoning\n",
        "    value: reasoning content\n",
        "  - kind: content\n",
        "    value: normal content\n",
        "  - kind: tool-call\n",
        "    id: tool-call-id-1\n",
        "    name: read-file\n",
        "    # although you can inline json inside yaml line, there is no need to do that\n",
        "    arguments: '{ pathname: \"src/main.rs\" }'\n",
        "  - kind: tool-call\n",
        "    # even chat completion api support parallel tool calls if you didn't notice\n",
        "    id: tool-call-id-2\n",
        "    name: read-file\n",
        "    arguments: '{ pathname: \"src/session.rs\" }'\n",
        "  # store some of the response information in case they are useful\n",
        "  response:\n",
        "    create-time: TODO\n",
        "    status-code: 200\n",
        "    header-x-ds-trace-id: x-ds-trace-id1\n",
        "    header-date: Sun, 25 Oct 2026 08:47:50 GMT\n",
        "    header-eo-log-uuid: eo-log-uuid1\n",
        "    model: deepseek-flasher\n",
        "    complete-time: 2026-10-23T06:29:10Z\n",
        "    token-usage: 42/325/799\n",
        "\n",
        "message-4:\n",
        "  parent-id: 3\n",
        "  role: user\n",
        "  # messages api support returning multiple tool results in one user message\n",
        "  # but chat completion api role=tool message can only include one tool call id,\n",
        "  # to avoid deciding how to map this kind of api to that kind of api for this scenario,\n",
        "  # allow multiple tool-result content blocks here but don't allow other kinds of content blocks\n",
        "  content:\n",
        "  - kind: tool-result\n",
        "    id: tool-call-id-1\n",
        "    value: |\n",
        "      use std::fs...\n",
        "      ...\n",
        "      struct Message...\n",
        "\n",
        "      fn read_session...\n",
        "      fn test_read...\n",
        "    metadata:\n",
        "      create-time: TODO\n",
        "      complete-time: etc.1\n",
        "      file-size: etc.2\n",
        "      return-size: etc.3\n",
        "      git-version: etc.4\n",
        "  - kind: tool-result\n",
        "    id: tool-call-id-2\n",
        "    value: |\n",
        "      use std::collections::{HashMap, BinaryHeap};...\n",
        "      ...\n",
        "\n",
        "message-5:\n",
        "  parent-id: 4\n",
        "  role: assistant\n",
        "  content:\n",
        "    this file contains...\n",
        "  response:\n",
        "    create-time: TODO\n",
        "    status-code: 200\n",
        "    token-usage: 100/200/300\n",
    ))?;
    assert_eq!(session.name, "session name");
    assert_eq!(session.messages.len(), 5);
    assert_eq!(session.messages[0].id, 1);
    assert_eq!(session.messages[0].parent_id, 0);
    assert_matches!(session.messages[0].role, Role::System);
    assert_eq!(session.messages[0].response_metadata.len(), 0);
    assert_eq!(session.messages[0].content.len(), 1);
    assert_matches!(&session.messages[0].content[0], ContentBlock::Content(TextBlock{ value }) if value == "You are a coding agent");
    assert_eq!(session.messages[1].id, 2);
    assert_eq!(session.messages[1].parent_id, 1);
    assert_matches!(session.messages[1].role, Role::User);
    assert_eq!(session.messages[1].response_metadata.len(), 0);
    assert_eq!(session.messages[1].content.len(), 1);
    assert_matches!(&session.messages[1].content[0], ContentBlock::Content(TextBlock{ value }) if value == "summary source code file src/main.rs");
    assert_eq!(session.messages[2].id, 3);
    assert_eq!(session.messages[2].parent_id, 2);
    assert_matches!(session.messages[2].role, Role::Assistant);
    assert_eq!(session.messages[2].content.len(), 4);
    assert_matches!(&session.messages[2].content[0], ContentBlock::Reasoning(TextBlock{ value }) if value == "reasoning content");
    assert_matches!(&session.messages[2].content[1], ContentBlock::Content(TextBlock{ value }) if value == "normal content");
    let ContentBlock::ToolCall(ToolCallBlock{ id, name, arguments }) = &session.messages[2].content[2] else {
        panic!("session.messages[2].content[2] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(name, "read-file");
    assert_eq!(arguments, "{ pathname: \"src/main.rs\" }");
    let ContentBlock::ToolCall(ToolCallBlock{ id, name, arguments }) = &session.messages[2].content[3] else {
        panic!("session.messages[2].content[3] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(name, "read-file");
    assert_eq!(arguments, "{ pathname: \"src/session.rs\" }");
    // read don't read response metadata
    assert_eq!(session.messages[2].response_metadata.len(), 0);
    // assert_eq!(session.messages[2].response_metadata[0].0, "create-time");
    // assert_matches!(&session.messages[2].response_metadata[0].1, serde_yaml_ng::Value::String(value) if value == "TODO");
    
    assert_eq!(session.messages[3].id, 4);
    assert_eq!(session.messages[3].parent_id, 3);
    assert_matches!(session.messages[3].role, Role::User);
    assert_eq!(session.messages[3].content.len(), 2);
    let ContentBlock::ToolResult(ToolResultBlock{ id, value, metadata }) = &session.messages[3].content[0] else {
        panic!("session.messages[3].content[0] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(value, "use std::fs...\n...\nstruct Message...\n\nfn read_session...\nfn test_read...\n");
    assert_eq!(metadata.len(), 0);
    let ContentBlock::ToolResult(ToolResultBlock{ id, value, metadata }) = &session.messages[3].content[1] else {
        panic!("session.messages[3].content[1] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(value, "use std::collections::{HashMap, BinaryHeap};...\n...\n");
    assert_eq!(metadata.len(), 0);

    assert_eq!(session.messages[4].id, 5);
    assert_eq!(session.messages[4].parent_id, 4);
    assert_matches!(session.messages[4].role, Role::Assistant);
    assert_eq!(session.messages[4].content.len(), 1);
    assert_matches!(&session.messages[4].content[0], ContentBlock::Content(TextBlock{ value }) if value == "this file contains...");

    Ok(())
}

#[test]
fn test_write() -> Result<()> {

    assert_eq!(format_message(Message {
        id: 1,
        parent_id: 0,
        role: Role::System,
        content: vec![ContentBlock::Content(TextBlock{ value: "You are a coding agent.".to_string() })],
        response_metadata: Vec::new(),
    })?, "message-1:\n  role: system\n  content: You are a coding agent.\n");

    assert_eq!(format_message(Message {
        id: 2,
        parent_id: 1,
        role: Role::User,
        content: vec![ContentBlock::Content(TextBlock{ value: "summary source code file src/main.rs.".to_string() })],
        response_metadata: Vec::new(),
    })?, "message-2:\n  parent-id: 1\n  role: user\n  content: summary source code file src/main.rs.\n");

    assert_eq!(format_message(Message {
        id: 3,
        parent_id: 2,
        role: Role::Assistant,
        content: vec![
            ContentBlock::Reasoning(TextBlock{ value: "why do you enable reasoning for this simple work?".to_string() }),
            ContentBlock::Content(TextBlock{ value: "let me read the files...".to_string() }),
            ContentBlock::ToolCall(ToolCallBlock{
                id: "id1".to_string(),
                name: "read-file".to_string(),
                arguments: "{ pathname: \"src/main.rs\" }".to_string(),
            }),
            ContentBlock::ToolCall(ToolCallBlock{
                id: "id2".to_string(),
                name: "read-file".to_string(),
                arguments: "{ pathname: \"src/session.rs\" }".to_string(),
            }),
        ],
        response_metadata: [
            ("create-time", "2026-10-23T06:29:00Z"),
            ("complete-time", "2026-10-23T06:29:30Z"),
            ("status-code", "200"),
            ("header-x-ds-trace-id", "x-ds-trace-id-1"),
            ("token-usage", "42/325/799"),
        ].into_iter().map(|(k, v)| (k.to_string(), serde_yaml_ng::Value::String(v.to_string()))).collect(),
    })?, concat!(
        "message-3:\n",
        "  parent-id: 2\n",
        "  role: assistant\n",
        "  content:\n",
        "  - kind: reasoning\n",
        "    value: why do you enable reasoning for this simple work?\n",
        "  - kind: content\n",
        "    value: let me read the files...\n",
        "  - kind: tool-call\n",
        "    id: id1\n",
        "    name: read-file\n",
        "    arguments: '{ pathname: \"src/main.rs\" }'\n",
        "  - kind: tool-call\n",
        "    id: id2\n",
        "    name: read-file\n",
        "    arguments: '{ pathname: \"src/session.rs\" }'\n",
        "  response:\n",
        "    create-time: 2026-10-23T06:29:00Z\n",
        "    complete-time: 2026-10-23T06:29:30Z\n",
        "    status-code: '200'\n",
        "    header-x-ds-trace-id: x-ds-trace-id-1\n",
        "    token-usage: 42/325/799\n",
    ));

    assert_eq!(format_message(Message {
        id: 4,
        parent_id: 3,
        role: Role::User,
        content: vec![
            ContentBlock::ToolResult(ToolResultBlock{
                id: "id1".to_string(),
                value: "use std::fs...".to_string(),
                metadata: vec![
                    ("create-time", "2026-10-23T06:29:00Z"),
                    ("complete-time", "2026-10-23T06:29:30Z"),
                ].into_iter().map(|(k, v)| (k.to_string(), serde_yaml_ng::Value::String(v.to_string()))).collect(),
            }),
            ContentBlock::ToolResult(ToolResultBlock{
                id: "id2".to_string(),
                value: "use std::collections...".to_string(),
                metadata: Vec::new(),
            }),
        ],
        response_metadata: Vec::new(),
    })?, concat!(
        "message-4:\n",
        "  parent-id: 3\n",
        "  role: user\n",
        "  content:\n",
        "  - kind: tool-result\n",
        "    id: id1\n",
        "    value: use std::fs...\n",
        "    metadata:\n",
        "      create-time: 2026-10-23T06:29:00Z\n",
        "      complete-time: 2026-10-23T06:29:30Z\n",
        "  - kind: tool-result\n",
        "    id: id2\n",
        "    value: use std::collections...\n",
    ));

    assert_eq!(format_message(Message {
        id: 5,
        parent_id: 42,
        role: Role::Assistant,
        content: vec![
            ContentBlock::Content(TextBlock{ value: "this file contains...\nand this file...".to_string() }),
        ],
        response_metadata: [
            ("create-time", "2026-10-53T06:29:00Z"),
            ("complete-time", "2026-10-53T06:29:30Z"),
            ("status-code", "418"),
            ("token-usage", "42/325/799"),
        ].into_iter().map(|(k, v)| (k.to_string(), serde_yaml_ng::Value::String(v.to_string()))).collect(),
    })?, concat!(
        "message-5:\n",
        "  parent-id: 42\n",
        "  role: assistant\n",
        // what's this |-
        "  content: |-\n",
        "    this file contains...\n",
        "    and this file...\n",
        "  response:\n",
        "    create-time: 2026-10-53T06:29:00Z\n",
        "    complete-time: 2026-10-53T06:29:30Z\n",
        "    status-code: '418'\n",
        "    token-usage: 42/325/799\n",
    ));

    Ok(())
}
