use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs;
use anyhow::{Context as _, Result, anyhow, bail};
use bytes::{BufMut as _, Bytes, BytesMut};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use reqwest;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug)]
struct TextBlock {
    // when exist, wrap content with <name>content</name>
    name: Option<String>,
    value: String,
    // reasoning signature is not used according to deepseek docs
}

#[derive(Debug)]
struct ToolUseBlock {
    id: String,
    name: String,
    input: String,
}

#[derive(Debug)]
struct ToolResultBlock {
    id: String,
    value: String,
    // tool execution information
    metadata: Vec<(String, serde_yaml_ng::Value)>,
}

#[derive(Debug)]
enum ContentBlock {
    // system, user, assistant, tool result content
    Text(TextBlock),
    Reasoning(TextBlock),
    ToolUse(ToolUseBlock),
    ToolResult(ToolResultBlock),
}

#[derive(Debug)]
enum ThinkingMode {
    Disabled,
    Enabled,
    Low,
    High,
    Max,
}

#[derive(Debug)]
struct RequestConfig {
    model: Option<String>,
    // default to disabled
    thinking: ThinkingMode,
    // name of tools
    tools: Vec<String>,
    max_tokens: Option<usize>,
}

#[derive(Debug)]
struct ResponseMetadata {
    // thinking switch in request
    thinking: ThinkingMode,
    // tools listed in request
    request_tools: Vec<String>,
    // request time
    start_time: DateTime<Utc>,
    // response complete time
    complete_time: DateTime<Utc>,
    // response status and headers
    status_code: usize,
    headers: Vec<(String, String)>,
    // result model
    model: String,
    stop_reason: String,
    // save json here, information only, no need to parse and save precisely
    usage: String,
    // extra information if useful
    extra: Vec<String>,
}

#[derive(Debug)]
struct Message {
    id: usize,
    parent_id: usize,
    role: Role,
    content: Vec<ContentBlock>,
    // manually selected request parameters like model and thinking
    // when writing message, will merge into response metadata after response complete
    request_config: Option<RequestConfig>,
    response_metadata: Option<ResponseMetadata>,
}

#[derive(Debug)]
struct Session {
    name: String,
    // - although system message is not in normal message array in messages api,
    //   and persistant schema is also using special top level property name, still
    //   store it in this messages array as it looks more clear
    // - this is a flattened array of message tree structure, items reference parent
    //   node by id and parent id, the system message don't have id
    messages: Vec<Message>,
}

trait YAMLNodeIntoInner {
    fn into_usize(self) -> Option<usize>;
    fn into_string(self) -> Option<String>;
    fn into_mapping(self) -> Option<serde_yaml_ng::Mapping>;
    fn into_sequence(self) -> Option<Vec<serde_yaml_ng::Value>>;
}
impl YAMLNodeIntoInner for serde_yaml_ng::Value {
    fn into_usize(self) -> Option<usize> {
        if let serde_yaml_ng::Value::Number(value) = self { value.as_u64().map(|v| v as usize) } else { None }
    }
    fn into_string(self) -> Option<String> {
        if let serde_yaml_ng::Value::String(value) = self { Some(value) } else { None }
    }
    fn into_mapping(self) -> Option<serde_yaml_ng::Mapping> {
        if let serde_yaml_ng::Value::Mapping(value) = self { Some(value) } else { None }
    }
    fn into_sequence(self) -> Option<Vec<serde_yaml_ng::Value>> {
        if let serde_yaml_ng::Value::Sequence(values) = self { Some(values) } else { None }
    }
}

fn deserialize_session(raw: &str) -> Result<Session> {
    use serde_yaml_ng::Value as Node;
    let document: Node = serde_yaml_ng::from_str(raw)?;
    let mut document = document.into_mapping().ok_or_else(|| anyhow!("top level not mapping?"))?;
    // println!("{:?}", document);

    let session_name = document.remove("name")
        .unwrap_or_else(|| "name".into())
        .into_string().ok_or_else(|| anyhow!("session name not string?"))?;
    let mut messages = Vec::new();

    for (key, value) in document {
        let key = key.into_string()
            .ok_or_else(|| anyhow!("oh very cool non-plain mapping key"))?;
        // allow some additional properties while don't actually read them
        if matches!(key.as_str(), "create-time") { continue; }

        // message name: message#1 or system message, for error message header
        let (message_id, message_name) = if key == "system" {
            (0, "system message".to_string())
        } else if let Some(message_id) = key.strip_prefix("message-") {
            let message_id = message_id.parse()
                .with_context(|| format!("failed to parse message id in property {}", key))?;
            (message_id, format!("message#{}", message_id))
        } else {
            bail!("unknown top level property {}", key)
        };

        let mut message_node = value.into_mapping()
            .ok_or_else(|| anyhow!("{}: message node not mapping?", message_name))?;

        // system message should not include these, skip them and later report as unknown property
        let (role, parent_id) = if key == "system" {
            (Role::System, 0)
        } else {
            let role = message_node.remove("role")
                .ok_or_else(|| anyhow!("{}: missing role", message_name))?
                .into_string().ok_or_else(|| anyhow!("{}: role is not string?", message_name))?;
            let role = match role.as_str() {
                "user" => Role::User,
                "assistant" => Role::Assistant,
                other => bail!("{}: unknown role {}", message_name, other),
            };
            let parent_id = message_node.remove("parent-id").unwrap_or(0.into())
                .into_usize().ok_or_else(|| anyhow!("{}: parent-id not positive integer?", message_name))?;
            (role, parent_id)
        };

        let request_config = if role != Role::Assistant {
            None
        } else if message_node.get("request").map(|n| n.is_null()).unwrap_or(false) {
            message_node.remove("request");
            Some(RequestConfig{ model: None, thinking: ThinkingMode::Disabled, tools: Vec::new(), max_tokens: None })
        } else if let Some(node) = message_node.remove("request") {
            let mut node = node.into_mapping()
                .ok_or_else(|| anyhow!("{}: request config node is not mapping?", message_name))?;

            let model = node.remove("model").map(|value| match value {
                Node::String(value) if
                    matches!(value.as_str(), "deepseek-flash" | "deepseek-pro") => Ok(value),
                Node::String(_) => Err(anyhow!("{}: unknown model name", message_name)),
                _ => Err(anyhow!("{}: model is not string?", message_name)),
            }).transpose()?;

            let thinking = node.remove("thinking").map(|value| match value {
                Node::Bool(true) => Ok(ThinkingMode::Enabled),
                Node::Bool(false) => Ok(ThinkingMode::Disabled),
                Node::String(value) => match value.as_str() {
                    // TODO is on/no/off regarded as bool in yaml parse?
                    "on" => Ok(ThinkingMode::Enabled),
                    "no" => Ok(ThinkingMode::Disabled),
                    "low" => Ok(ThinkingMode::Low),
                    "high" => Ok(ThinkingMode::High),
                    "max" => Ok(ThinkingMode::Max),
                    _ => Err(anyhow!("{}: unknown thinking mode", message_name)),
                },
                _ => Err(anyhow!("{}: thinking mode is not string or bool?", message_name)),
            }).transpose()?.unwrap_or(ThinkingMode::Disabled);

            let max_tokens = node.remove("max-tokens").map(|value|
                value.into_usize().ok_or_else(|| anyhow!("max-tokens not number?"))).transpose()?;
            let tools = node.remove("tools").map(|value| -> Result<Vec<String>> {
                let mut tools = Vec::new();
                for value in value.into_sequence()
                    .ok_or_else(|| anyhow!("{}: tools should be array of names", message_name))?
                {
                    tools.push(value.into_string()
                        .ok_or_else(|| anyhow!("{}: tools element not string?", message_name))?);
                }
                Ok(tools)
            }).transpose()?.unwrap_or_default();

            Some(RequestConfig{ model, thinking, tools, max_tokens })
        } else { None };
        // no need to read completed assistant message's response metadata, it is not used again
        message_node.remove("response");

        let mut content_blocks = Vec::new();
        match message_node.remove("content") {
            // if has request config, there should be no content
            None if request_config.is_some() => {},
            // otherwise it is required
            None => bail!("{}: missing content", message_name),
            // if has request config, there should be no content
            Some(_) if request_config.is_some() =>
                bail!("{}: should not have content if have request config", message_name),
            // normal plain string
            Some(Node::String(value)) => {
                content_blocks.push(ContentBlock::Text(TextBlock{ value, name: None }));
            },
            Some(Node::Sequence(block_nodes)) => for (block_index, block_node) in block_nodes.into_iter().enumerate() {
                // error message header
                let block_name = format!("{}: content#{}", message_name, block_index);
                let mut block_node = block_node.into_mapping().ok_or_else(|| anyhow!("{}: node not mapping?", block_name))?;

                let kind = block_node.remove("kind")
                    .ok_or_else(|| anyhow!("{}: block kind missing", block_name))?
                    .into_string().ok_or_else(|| anyhow!("{}: block kind is not string?", block_name))?;
                match kind.as_str() {
                    "text" => {
                        // should not use text block name in assistant message
                        let name = if role == Role::Assistant { None } else { block_node.remove("name")
                            .map(|v| v.into_string()
                            .ok_or_else(|| anyhow!("{}: block name not string?", block_name))).transpose()? };
                        let value = block_node.remove("value").and_then(|v| v.into_string())
                            .ok_or_else(|| anyhow!("{}: block value missing or is not string", block_name))?;
                        content_blocks.push(ContentBlock::Text(TextBlock{ name, value }));
                    },
                    "reasoning" => {
                        if role != Role::Assistant {
                            bail!("{}: reasoning block not allowed in non assistant message", block_name);
                        }
                        // reasoning block don't have an explicit name
                        let value = block_node.remove("value").and_then(|v| v.into_string())
                            .ok_or_else(|| anyhow!("{}: block value missing or is not string", block_name))?;
                        content_blocks.push(ContentBlock::Reasoning(TextBlock{ value, name: None }));
                    },
                    "tool-use" => {
                        if role != Role::Assistant {
                            bail!("{}: tool-use block not allowed in non assistant message", block_name);
                        }
                        let id = block_node.remove("id").and_then(|v| v.into_string())
                            .ok_or_else(|| anyhow!("{}: tool use id missing or is not string", block_name))?;
                        let name = block_node.remove("name").and_then(|v| v.into_string())
                            .ok_or_else(|| anyhow!("{}: tool use name missing or is not string", block_name))?;
                        let input = block_node.remove("input").and_then(|v| v.into_string())
                            .ok_or_else(|| anyhow!("{}: tool use input missing or is not string", block_name))?;
                        content_blocks.push(ContentBlock::ToolUse(ToolUseBlock{ id, name, input }));
                    },
                    "tool-result" => {
                        if role != Role::User {
                            bail!("{}: tool-result block not allowed in non user message", block_name);
                        }
                        let id = block_node.remove("id").and_then(|v| v.into_string())
                            .ok_or_else(|| anyhow!("{}: tool use id missing or is not string", block_name))?;
                        let value = block_node.remove("value").and_then(|v| v.into_string())
                            .ok_or_else(|| anyhow!("{}: block value missing or is not string", block_name))?;
                        // no need to read completed tool use's execution metadata, it is not used again
                        block_node.swap_remove("metadata");
                        content_blocks.push(ContentBlock::ToolResult(ToolResultBlock{ id, value, metadata: Vec::new() }));
                    },
                    other => bail!("{}: unknown block kind {}", block_name, other),
                }
                if !block_node.is_empty() {
                    bail!("{}: unknown properties {:?}", block_name, block_node.keys().collect::<Vec<_>>());
                }
            },
            Some(_) => bail!("{}: content is not string or sequence?", message_name),
        }
        if !message_node.is_empty() {
            bail!("{}: unknown properties {:?}", message_name, message_node.keys().collect::<Vec<_>>());
        }
        messages.push(Message{
            id: message_id,
            parent_id,
            role,
            content: content_blocks,
            request_config,
            response_metadata: None,
        });
    }

    let mut existing_message_ids = HashSet::with_capacity(messages.len());
    for message in &messages {
        // 1. duplicate id
        if !existing_message_ids.insert(message.id) {
            bail!("duplicate message id {}", message.id);
        }
        // 2. parent id
        // will not meet system message id not 0, system message parent id not 0 or non system message id 0 here
        let parent_message = if message.parent_id != 0 {
            Some(messages.iter().find(|m| m.id == message.parent_id)
                .ok_or_else(|| anyhow!("message#{}: parent id {} not exist", message.id, message.parent_id))?)
        } else { None };
        // 3. parent role relationship
        if !matches!((message.role, parent_message),
            | (_, None)
            | (Role::User, Some(Message{ role: Role::Assistant, .. }))
            | (Role::Assistant, Some(Message{ role: Role::User, .. })))
        {
            bail!("message#{}: unexpected parent message role relationship", message.id);
        }
        // 4. tool use id match
        for content_block in &message.content {
            if let ContentBlock::ToolResult(ToolResultBlock{ id: result_id, .. }) = content_block {
                let parent_message = parent_message.ok_or_else(||
                    anyhow!("message#{}: cannot have tool result block if no parent message", message.id))?;
                if !parent_message.content.iter().any(|p| matches!(p, ContentBlock::ToolUse(ToolUseBlock{ id: use_id, .. }) if use_id == result_id)) {
                    bail!("message#{}: tool result id not found in parent message tool use blocks", message.id);
                }
           }
        }
    }

    messages.sort_by_key(|m| m.id);
    Ok(Session{ name: session_name, messages })
}

// only append seems good
fn serialize_assistant_message(message: Message) -> Result<String> {
    use serde_yaml_ng::{Value as Node, Mapping};

    let mut message = message;
    let mut message_node = Mapping::new();
    assert!(message.parent_id > 0, "missing parent id");
    message_node.insert("parent-id".into(), Node::Number(message.parent_id.into()));
    assert_eq!(message.role, Role::Assistant, "role not assistant?");
    message_node.insert("role".into(), "assistant".into());
    if message.content.len() == 1 {
        if let ContentBlock::Text(block) = message.content.pop().unwrap() {
            // result assistant message will not have text block name
            message_node.insert("content".into(), Node::String(block.value));
        }
    } else {
        let mut block_nodes = Vec::new();
        for content_block in message.content {
            let mut block_node = Mapping::new();
            match content_block {
                ContentBlock::Text(TextBlock { value, .. }) => {
                    // result assistant message will not have text block name
                    block_node.insert("kind".into(), "text".into());
                    block_node.insert("value".into(), Node::String(value));
                },
                ContentBlock::Reasoning(TextBlock { value, .. }) => {
                    block_node.insert("kind".into(), "reasoning".into());
                    block_node.insert("value".into(), Node::String(value));
                },
                ContentBlock::ToolUse(ToolUseBlock { id, name, input }) => {
                    block_node.insert("kind".into(), "tool-use".into());
                    block_node.insert("id".into(), Node::String(id));
                    block_node.insert("name".into(), Node::String(name));
                    block_node.insert("input".into(), Node::String(input));
                },
                ContentBlock::ToolResult(ToolResultBlock { id, value, metadata }) => {
                    block_node.insert("kind".into(), "tool-result".into());
                    block_node.insert("id".into(), Node::String(id));
                    block_node.insert("value".into(), Node::String(value));
                    let mut metadata_node = Mapping::new();
                    for (key, value) in metadata {
                        metadata_node.insert(Node::String(key), value);
                    }
                    if !metadata_node.is_empty() {
                        block_node.insert("metadata".into(), Node::Mapping(metadata_node));
                    }
                },
            }
            block_nodes.push(Node::Mapping(block_node));
        }
        message_node.insert("content".into(), Node::Sequence(block_nodes));
    }
    if let Some(response_metadata) = message.response_metadata {
        let mut response_metadata_node = Mapping::new();
        response_metadata_node.insert("thinking".into(), Node::String(match response_metadata.thinking {
            ThinkingMode::Disabled => "no",
            ThinkingMode::Enabled => "on",
            ThinkingMode::Low => "low",
            ThinkingMode::High => "high",
            ThinkingMode::Max => "max",
        }.to_string()));
        response_metadata_node.insert("request-tools".into(),
            Node::Sequence(response_metadata.request_tools.into_iter().map(|v| Node::String(v)).collect()));
        response_metadata_node.insert("start-time".into(), format!("{:?}", response_metadata.start_time).into());
        response_metadata_node.insert("complete-time".into(), format!("{:?}", response_metadata.complete_time).into());
        response_metadata_node.insert("status-code".into(), response_metadata.status_code.into());
        for (key, value) in response_metadata.headers {
            response_metadata_node.insert(format!("header-{}", key).into(), value.into());
        }
        response_metadata_node.insert("model".into(), response_metadata.model.into());
        response_metadata_node.insert("stop-reason".into(), response_metadata.stop_reason.into());
        response_metadata_node.insert("usage".into(), response_metadata.usage.into());
        if !response_metadata.extra.is_empty() {
            response_metadata_node.insert("extra".into(),
                Node::Sequence(response_metadata.extra.into_iter().map(|v| Node::String(v)).collect()));
        }
        message_node.insert("response".into(), Node::Mapping(response_metadata_node));
    }

    let mut new_document = Mapping::new();
    new_document.insert(Node::String(format!("message-{}", message.id)), Node::Mapping(message_node));
    Ok(serde_yaml_ng::to_string(&Node::Mapping(new_document))?)
}

fn prepare_request(session: &Session) -> Result<serde_json::Value> {
    use serde_json::Value as Node;
    use serde_json::json;

    let Some((target_message, request_config)) = session.messages
        .iter().find_map(|m| m.request_config.as_ref().map(|c| (m, c))) else
    {
        bail!("no message is requesting, if you don't need related config, add an empty request element");
    };
    let mut thread = vec![target_message];
    let mut parent_id = target_message.parent_id;
    while parent_id != 0 {
        // unwrap: validated parent id exist
        // already validated parent message relationship, no need to validate role here
        let parent_message = session.messages.iter().find(|m| m.id == parent_id).unwrap();
        thread.push(parent_message);
        parent_id = parent_message.parent_id;
    }
    // unwrap: thread have at least one element
    // only need validated last (thread start) message role
    if thread.last().unwrap().role != Role::User {
        let thread_ids = thread.iter().map(|m| format!("{}({})",
            m.id, if m.role == Role::User { "user" } else { "assistant" })).collect::<Vec<_>>();
        bail!("thread does not start with user message, thread: {:?}", thread_ids);
    }

    // reverse is here
    thread.reverse();
    // reverse is here

    let mut body = serde_json::Map::<String, Node>::new();
    body.insert("model".to_string(), Node::String(
        request_config.model.as_deref().unwrap_or("deepseek-flash").to_string()));

    if let Some(system_message) = session.messages.iter().find(|m| m.role == Role::System) {
        // now you can use same structure
        if system_message.content.len() == 1 {
            let ContentBlock::Text(TextBlock{ name, value }) = &system_message.content[0] else { unreachable!() };
            if let Some(name) = name {
                body.insert("system".to_string(), Node::String(format!("<{}>{}<{}>", name, value, name)));
            } else {
                body.insert("system".to_string(), Node::String(value.to_string()));
            }
        } else {
            let mut block_nodes = Vec::new();
            for content_block in &system_message.content {
                let ContentBlock::Text(TextBlock{ name, value }) = content_block else { unreachable!() };
                if let Some(name) = name {
                    block_nodes.push(Node::Object(serde_json::Map::from_iter([
                        ("type".to_string(), Node::String("text".to_string())),
                        ("text".to_string(), Node::String(format!("<{}>{}<{}>", name, value, name))),
                    ])));
                } else {
                    block_nodes.push(Node::Object(serde_json::Map::from_iter([
                        ("type".to_string(), Node::String("text".to_string())),
                        ("text".to_string(), Node::String(value.to_string())),
                    ])));
                }
            }
            body.insert("system".to_string(), Node::Array(block_nodes));
        }
    }

    let mut message_nodes = Vec::new();
    for message in thread {
        let content_node;
        if message.role == Role::User {
            if message.content.len() == 1 && matches!(message.content[0], ContentBlock::Text(_)) {
                let ContentBlock::Text(TextBlock{ name, value }) = &message.content[0] else { unreachable!() };
                if let Some(name) = name {
                    content_node = Node::String(format!("<{}>{}<{}>", name, value, name));
                } else {
                    content_node = Node::String(value.to_string());
                }
            } else {
                let mut block_nodes = Vec::new();
                for content_block in &message.content {
                    if let ContentBlock::Text(TextBlock{ name, value }) = content_block {
                        if let Some(name) = name {
                            block_nodes.push(Node::Object(serde_json::Map::from_iter([
                                ("type".to_string(), Node::String("text".to_string())),
                                ("text".to_string(), Node::String(format!("<{}>{}<{}>", name, value, name))),
                            ])));
                        } else {
                            block_nodes.push(Node::Object(serde_json::Map::from_iter([
                                ("type".to_string(), Node::String("text".to_string())),
                                ("text".to_string(), Node::String(value.to_string())),
                            ])));
                        }
                    } else if let ContentBlock::ToolResult(ToolResultBlock{ id, value, .. }) = content_block {
                        block_nodes.push(Node::Object(serde_json::Map::from_iter([
                            ("type".to_string(), Node::String("tool_result".to_string())),
                            ("tool_use_id".to_string(), Node::String(id.to_string())),
                            // by the way, this can also be content block array
                            ("content".to_string(), Node::String(value.to_string())),
                        ])));
                    }
                }
                content_node = Node::Array(block_nodes);
            }
            message_nodes.push(Node::Object(serde_json::Map::from_iter([
                ("role".to_string(), Node::String("user".to_string())),
                ("content".to_string(), content_node),
            ])));
        } else if message.role == Role::Assistant && !message.content.is_empty() { // exclude target message
            if message.content.len() == 1 && matches!(message.content[0], ContentBlock::Text(_)) {
                let ContentBlock::Text(TextBlock{ name, value }) = &message.content[0] else { unreachable!() };
                if let Some(name) = name {
                    content_node = Node::String(format!("<{}>{}<{}>", name, value, name));
                } else {
                    content_node = Node::String(value.to_string());
                }
            } else {
                let mut block_nodes = Vec::new();
                for content_block in &message.content {
                    if let ContentBlock::Text(TextBlock{ value, .. }) = content_block {
                        block_nodes.push(Node::Object(serde_json::Map::from_iter([
                            ("type".to_string(), Node::String("text".to_string())),
                            ("text".to_string(), Node::String(value.to_string())),
                        ])));
                    } else if let ContentBlock::Reasoning(TextBlock{ value, .. }) = content_block {
                        // what do you mean by Pass it back unchanged when continuing a tool-call turn in thinking mode.
                        block_nodes.push(Node::Object(serde_json::Map::from_iter([
                            ("type".to_string(), Node::String("thinking".to_string())),
                            ("thinking".to_string(), Node::String(value.to_string())),
                        ])));
                    } else if let ContentBlock::ToolUse(ToolUseBlock{ id, name, input }) = content_block {
                        block_nodes.push(Node::Object(serde_json::Map::from_iter([
                            ("type".to_string(), Node::String("tool_use".to_string())),
                            ("id".to_string(), Node::String(id.to_string())),
                            ("name".to_string(), Node::String(name.to_string())),
                            ("input".to_string(), Node::String(input.to_string())),
                        ])));
                    }
                }
                content_node = Node::Array(block_nodes);
            }
            message_nodes.push(Node::Object(serde_json::Map::from_iter([
                ("role".to_string(), Node::String("user".to_string())),
                ("content".to_string(), content_node),
            ])));
        }
    }
    body.insert("messages".to_string(), Node::Array(message_nodes));

    if let Some(max_tokens) = request_config.max_tokens {
        body.insert("max_tokens".to_string(), Node::Number(max_tokens.into()));
    }
    body.insert("stream".to_string(), Node::Bool(true));
    match request_config.thinking {
        ThinkingMode::Disabled => body.insert("thinking".to_string(), 
            Node::Object(serde_json::Map::from_iter([("type".to_string(), Node::String("disabled".to_string()))]))), // < this is very colorful
        ThinkingMode::Enabled => body.insert("thinking".to_string(), 
            Node::Object(serde_json::Map::from_iter([("type".to_string(), Node::String("enabled".to_string()))]))),
        ThinkingMode::Low => body.insert("output_config".to_string(), 
            Node::Object(serde_json::Map::from_iter([("effort".to_string(), Node::String("low".to_string()))]))),
        ThinkingMode::High => body.insert("output_config".to_string(), 
            Node::Object(serde_json::Map::from_iter([("effort".to_string(), Node::String("high".to_string()))]))),
        ThinkingMode::Max => body.insert("output_config".to_string(), 
            Node::Object(serde_json::Map::from_iter([("effort".to_string(), Node::String("max".to_string()))]))),
    };

    // now you have to use json!
    body.insert("tools".to_string(), json!([
        {
            "name": "read-file",
            "description": "Read the contents of a file. Line numbers are 1-indexed. This tool will truncate its output at 2000 lines and may be called repeatedly with offset and limit parameters to read larger files in chunks. Binary files use offset/limit as byte offsets.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pathname": {
                        "type": "string",
                        "description": "The path of the file to read.",
                    },
                    "offset": {
                        "type": "number",
                        "description": "Optional: the 1-based line number to start reading from. Only use this if the file is too large to read at once. If not specified, the file will be read from the beginning.",
                    },
                    "limit": {
                        "type": "number",
                        "description": "Optional: the maximum number of lines to read. Only use this together with `offset` if the file is too large to read at once.",
                    }
                },
                "required": ["pathname"],
            },
        },
    ]));
    println!("request body {}", serde_json::to_string(&body)?);
    Ok(Node::Object(body))
}

// html spec (why is this not rfc) https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
// mdn https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format
// by the way, microsoft branded not active developing but active downloaded package https://www.npmjs.com/package/@microsoft/fetch-event-source

// according to spec
// - stream = event*
// - event = (comment | field)* EOL
// - comment = COLON ANY* EOL
// - field = field-name (COLON SPACE ANY*)? EOL   # this space don't have star
// - field-name = ANYEXCEPT*                      # any char except colon, cr and lf
// - EOL = CR | LF | CR LF
// - ANY is any utf8 char, ANY* is any utf8 sequence

// - the common practice is split whole response by \n\n, and then split message (event) by \n into fields, but actually
//   the \n\n comes from field's eol + message's eol, if the final message miss the eol, it is not complete and is not dispatched
// - a field can have extra space after the colon, but not before, before the colon is always field name
//   field without colon is regarded all as field name and no field value, what's the usage? emptify last event id and event type?
// - for web EventSource api, field names allow id, event, data, retry, others are ignored
//   - id does not allow \0?, or else it is ignored, why specifically related to id?
//     use in last-event-id, while I don't see any discussion about this in ai apis?
//   - event is event name use in .addEventListener
//   - data is data, can have multiple data in one message, they are concat with .join(\n)
//   - retry is retry time, why do server send this?
//   - if you have control of server and client side you can have custom field names? not for this scenario
// - a message with empty data is not dispatched
// - there is NO guarantee over a message will not be cut in the middle in 2 transmits,
//   there is NO guarantee over a utf8 multi byte character will not be cut in the middle in 2 transmits,
//   so you need a byte level parser to parse messages

#[derive(Debug)]
// id is not used in llm apis
struct Event {
    name: Option<String>,
    data: String,
}

struct EventStreamParser {
    buffer: BytesMut,
    position: usize,
    current_event: Option<Vec<u8>>,
    current_data: BytesMut,
}
impl EventStreamParser {
    fn new() -> Self {
        Self {
            buffer: BytesMut::with_capacity(1024),
            position: 0,
            current_event: None,
            current_data: BytesMut::with_capacity(1024),
        }
    }

    fn push(&mut self, bytes: Bytes) {
        self.buffer.extend_from_slice(&bytes);
    }
    // only return event.data as llm apis do not use id and type properties
    // no expected error yet, still return Result in case needed in future
    fn pull(&mut self, extra: &mut Vec<String>) -> Result<Option<Event>> {
        loop {
            // eol begin index and eol end index, same for bare cr and normal lf, +1 for crlf
            let eol_index = match (
                self.buffer.iter().skip(self.position).position(|b| *b == b'\r'),
                self.buffer.iter().skip(self.position).position(|b| *b == b'\n'),
            ) {
                // line not completed, wait for more
                (None, None) => return Ok(None),
                // cannot decide bare cr if it is exactly end of current buffer, wait for more
                (Some(cr_index), None) if cr_index == self.buffer.len() - 1 => return Ok(None),
                // bare cr
                (Some(cr_index), None) => (cr_index, cr_index),
                (Some(cr_index), Some(lf_index)) if cr_index + 1 < lf_index => (cr_index, cr_index),
                // normal lf
                (None, Some(lf_index)) => (lf_index, lf_index),
                (Some(cr_index), Some(lf_index)) if cr_index > lf_index => (lf_index, lf_index),
                // crlf
                (Some(cr_index), Some(lf_index)) if cr_index + 1 == lf_index => (cr_index, lf_index),
                // previous conditions have fully covered cr_index and lf_index relationships, but compiler don't know that
                _ => unreachable!("unexpected cr_index and lf_index relationship"),
            };
            // note the previous eol index is relative to self.position
            let eol_index = (eol_index.0 + self.position, eol_index.1 + self.position);

            if eol_index.0 == self.position { // empty line, end of message
                if let Some(c) = self.current_data.last() && c == &b'\n' {
                    // according to spec, trim one ending lf, making data concat effectively join(\n)
                    self.current_data.truncate(self.current_data.len() - 1);
                }
                // discard used buffer
                self.buffer = self.buffer.split_off(eol_index.1 + 1);
                self.position = 0;
                // // from_utf8_lossy_owned is super new rust 1.99 function
                let result_event = self.current_event.take().map(|v| String::from_utf8_lossy_owned(v));
                let result_data = String::from_utf8_lossy_owned(self.current_data.split_off(0).to_vec());
                // according to spec, do not dispatch no data event
                return if result_data.is_empty() { Ok(None) } else { Ok(Some(Event{ name: result_event, data: result_data })) };
            } else {
                // field without eol
                let field = &self.buffer[self.position..eol_index.0];
                self.position = eol_index.1 + 1;
                let (name, value) = if let Some(colon_index) = field.iter().position(|b| *b == b':') {
                    // note the result value may be empty
                    (&field[..colon_index], &field[colon_index + 1..])
                } else {
                    extra.push(format!("event-stream-parser-full-name-field: you really have this? {:?}", field));
                    (field, &[] as &[u8]) // you need this as to convert from &[{unknown};0] to &[u8]?
                };
                if name.is_empty() {
                    extra.push(format!("event-stream-parser-comment-field: you really have comment? {:?}: {:?}", name, value));
                } else if name == b"data" {
                    // according to spec, remove one ascii whitespace from beginning of value
                    let value = if !value.is_empty() && value[0] == b' ' { &value[1..] } else { value };
                    self.current_data.extend_from_slice(value);
                    // according to spec, join data lines by single lf regardless of actual eol
                    self.current_data.put_u8(b'\n');
                } else if name == b"event" {
                    // according to spec, remove one ascii whitespace from beginning of value
                    let value = if !value.is_empty() && value[0] == b' ' { &value[1..] } else { value };
                    // overwrite if duplicate field name
                    self.current_event = Some(value.to_vec());
                } else {
                    extra.push(format!("event-stream-parser-non-data-field: you really have non data field? {:?}: {:?}", name, value));
                }
            }
        }
    }
}

fn merge_delta(result: &mut serde_json::Value, delta: serde_json::Value) -> Result<()> {
    
    // there is no spec for this delta format, they (the designers of chat completion api) think up of this on their own
    // an event (a json document) is mainly
    // - content leading object (for the role=assistant?)
    // - content delta (or reasoning content delta), append to existing content by choice-object.index, are there really multiple choice responses?
    // - tool call leading object (for tool call id and function name),
    // - tool call arguments delta, append to argument content by tool-call-object.index
    // - ending object, finish reason = stop/tool call, token usage statistics
    //
    // oh good, deepseek harness is compacting delta objects to make memory efficient while lossless, results in
    // { kind: text-chunks, index: 0, time0: 1000, time_deltas: [5, 10, 7], texts: ['hello', ' world', '!'] },
    // { kind: tool-call-chunks, index: 0, id: tool-call-id-1, name: read-file, time0: 2000, time_deltas: [...], texts: ['{', ' path',, 'name', ..., '}'] },
    // { kind: other, finish-reason: tool call, token-usage: ... }
    // see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/tests/assistant-stream.spec.ts
    //
    // oh good, a/ messages api is using an efficient { type: content-block-delta, delta: { type: text-delta/thinking-delta, text: 'token' } }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    
    let serialized_session = fs::read_to_string("example-input.yml")?;
    let session = deserialize_session(&serialized_session)?;
    println!("session name {}", session.name);
    println!("{:?}", session);

    let body = prepare_request(&session)?;

    // let client = reqwest::Client::builder().build()?;
    // let request = client
    //     .post("https://api.deepseek.com/chat/completions")
    //     .header("content-type", "application/json")
    //     .bearer_auth(api_key)
    //     .body(body).build()?;
    // let response = client.execute(request).await?;

    // let status = response.status();
    // if !status.is_success() {
    //     let body = response.text().await?;
    //     bail!("response error {}: {}", status, body);
    // }
    // for (name, value) in response.headers() {
    //     println!("header {}: {:?}", name, value);
    // }

    // let mut parser = EventStreamParser::new();
    // let mut stream = response.bytes_stream();
    // let mut result_document = serde_json::Map::new();

    // while let Some(chunk) = stream.next().await {
    //     parser.push(chunk?);
    //     while let Some(data) = parser.pull()? {
    //         don't forget the ending [DONE]!
    //         let delta_document: serde_json::Value = serde_json::from_str(&data)?;
    //         // TODO things outside delta only append property entry (ignore property already exist)
    //         // things inside delta if not falsy (undefined, null, 0) always append string
    //         delta_document.as_object().unwrap().keys()
    //     }
    // }

    // let formatted = format_session(session)?;
    // fs::write("example-output.yml", formatted)?;

    Ok(())
}

#[test]
fn test_read() {
    use std::assert_matches;

    let session = deserialize_session(concat!(
        "name: session name\n",
        "create-time: 2026-10-22T07:59:00Z\n",
        "\n",
        "system:\n",
        "  content: You are a coding agent\n",
        "\n",
        "message-1:\n",
        "  role: user\n",
        "  content:\n",
        "    summary source code file src/main.rs\n",
        "\n",
        "message-3:\n",
        "  parent-id: 1\n",
        "  role: assistant\n",
        "  content:\n",
        "  - kind: reasoning\n",
        "    value: reasoning content\n",
        "  - kind: text\n",
        "    value: normal content\n",
        "  - kind: tool-use\n",
        "    id: tool-call-id-1\n",
        "    name: read-file\n",
        "    # although you can inline json inside yaml line, there is no need to do that\n",
        "    input: '{ pathname: \"src/main.rs\" }'\n",
        "  - kind: tool-use\n",
        "    # even chat completion api support parallel tool calls if you didn't notice\n",
        "    id: tool-call-id-2\n",
        "    name: read-file\n",
        "    input: '{ pathname: \"src/session.rs\" }'\n",
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
        "  content:\n",
        "  - kind: text\n",
        "    name: additional-manual-description\n",
        "    value: additional manual description\n",
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
        "  request:\n",
        "    model: deepseek-pro\n",
        "    thinking: true\n",
        "    tools: [read-file]\n",
    )).expect("failed to read");

    assert_eq!(session.name, "session name");
    assert_eq!(session.messages.len(), 5);
    assert_eq!(session.messages[0].id, 0);
    assert_eq!(session.messages[0].parent_id, 0);
    assert_matches!(session.messages[0].role, Role::System);
    assert!(session.messages[0].response_metadata.is_none());
    assert_eq!(session.messages[0].content.len(), 1);
    assert_matches!(&session.messages[0].content[0], ContentBlock::Text(TextBlock{ value, .. }) if value == "You are a coding agent");
    assert_eq!(session.messages[1].id, 1);
    assert_eq!(session.messages[1].parent_id, 0);
    assert_matches!(session.messages[1].role, Role::User);
    assert!(session.messages[0].response_metadata.is_none());
    assert_eq!(session.messages[1].content.len(), 1);
    assert_matches!(&session.messages[1].content[0], ContentBlock::Text(TextBlock{ value, .. }) if value == "summary source code file src/main.rs");
    assert_eq!(session.messages[2].id, 3);
    assert_eq!(session.messages[2].parent_id, 1);
    assert_matches!(session.messages[2].role, Role::Assistant);
    assert_eq!(session.messages[2].content.len(), 4);
    assert_matches!(&session.messages[2].content[0], ContentBlock::Reasoning(TextBlock{ value, .. }) if value == "reasoning content");
    assert_matches!(&session.messages[2].content[1], ContentBlock::Text(TextBlock{ value, .. }) if value == "normal content");
    let ContentBlock::ToolUse(ToolUseBlock{ id, name, input }) = &session.messages[2].content[2] else {
        panic!("session.messages[2].content[2] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(name, "read-file");
    assert_eq!(input, "{ pathname: \"src/main.rs\" }");
    let ContentBlock::ToolUse(ToolUseBlock{ id, name, input }) = &session.messages[2].content[3] else {
        panic!("session.messages[2].content[3] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(name, "read-file");
    assert_eq!(input, "{ pathname: \"src/session.rs\" }");
    // read don't read response metadata
    assert!(session.messages[0].response_metadata.is_none());
    // assert_eq!(session.messages[2].response_metadata[0].0, "create-time");
    // assert_matches!(&session.messages[2].response_metadata[0].1, serde_yaml_ng::Value::String(value) if value == "TODO");
    
    assert_eq!(session.messages[3].id, 4);
    assert_eq!(session.messages[3].parent_id, 3);
    assert_matches!(session.messages[3].role, Role::User);
    assert_eq!(session.messages[3].content.len(), 3);
    assert_matches!(&session.messages[3].content[0], ContentBlock::Text(TextBlock{ value, name })
        if name.as_deref() == Some("additional-manual-description") && value == "additional manual description");
    let ContentBlock::ToolResult(ToolResultBlock{ id, value, metadata }) = &session.messages[3].content[1] else {
        panic!("session.messages[3].content[1] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(value, "use std::fs...\n...\nstruct Message...\n\nfn read_session...\nfn test_read...\n");
    assert_eq!(metadata.len(), 0);
    let ContentBlock::ToolResult(ToolResultBlock{ id, value, metadata }) = &session.messages[3].content[2] else {
        panic!("session.messages[3].content[2] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(value, "use std::collections::{HashMap, BinaryHeap};...\n...\n");
    assert_eq!(metadata.len(), 0);
    assert_eq!(session.messages[4].id, 5);
    assert_eq!(session.messages[4].parent_id, 4);
    assert_matches!(session.messages[4].role, Role::Assistant);
    assert_eq!(session.messages[4].content.len(), 0);
    let Some(request_config) = &session.messages[4].request_config else {
        panic!("session.messages[4].request_config not some");
    };
    assert_eq!(request_config.model.as_deref(), Some("deepseek-pro"));
    assert_matches!(request_config.thinking, ThinkingMode::Enabled);
    assert_eq!(request_config.tools, vec!["read-file".to_string()]);

    // null request config
    // first message in thread is not user is checked in prepare request, not read
    let session = deserialize_session(concat!(
        "message-5:\n",
        "  role: assistant\n",
        "  request:\n",
    )).expect("failed to read");
    assert_eq!(session.messages.len(), 1);
    assert_eq!(session.messages[0].id, 5);
    assert_eq!(session.messages[0].parent_id, 0);
    assert_matches!(session.messages[0].role, Role::Assistant);
    assert_eq!(session.messages[0].content.len(), 0);
    let Some(request_config) = &session.messages[0].request_config else {
        panic!("session.messages[0].request_config not some");
    };
    assert_eq!(request_config.model.as_deref(), None);
    assert_matches!(request_config.thinking, ThinkingMode::Disabled);
    assert_eq!(request_config.tools, Vec::<String>::new());
}

#[test]
fn test_write() {
    use chrono::TimeZone;

    assert_eq!(serialize_assistant_message(Message {
        id: 3,
        parent_id: 2,
        role: Role::Assistant,
        content: vec![
            ContentBlock::Reasoning(TextBlock{ value: "why do you enable reasoning for this simple work?".to_string(), name: None }),
            ContentBlock::Text(TextBlock{ value: "let me read the files...".to_string(), name: None }),
            ContentBlock::ToolUse(ToolUseBlock{
                id: "id1".to_string(),
                name: "read-file".to_string(),
                input: "{ pathname: \"src/main.rs\" }".to_string(),
            }),
            ContentBlock::ToolUse(ToolUseBlock{
                id: "id2".to_string(),
                name: "read-file".to_string(),
                input: "{ pathname: \"src/session.rs\" }".to_string(),
            }),
        ],
        request_config: None,
        response_metadata: Some(ResponseMetadata{
            thinking: ThinkingMode::High,
            request_tools: vec!["tool1".to_string(), "tool2".to_string()],
            start_time: Utc.with_ymd_and_hms(2026, 10, 31, 12, 33, 0).unwrap(),
            complete_time: Utc.with_ymd_and_hms(2026, 10, 31, 12, 35, 0).unwrap(),
            status_code: 200,
            headers: vec![("x-ds-trace-id".to_string(), "x-ds-trace-id-1".to_string())],
            model: "deepseek-flasher".to_string(),
            stop_reason: "tool_use".to_string(),
            usage: r#"{"input_tokens":400,"cache_read_input_tokens":0,"output_tokens":40}"#.to_string(),
            extra: Vec::new(),
        }),
    }).expect("failed to serialize"), concat!(
        "message-3:\n",
        "  parent-id: 2\n",
        "  role: assistant\n",
        "  content:\n",
        "  - kind: reasoning\n",
        "    value: why do you enable reasoning for this simple work?\n",
        "  - kind: text\n",
        "    value: let me read the files...\n",
        "  - kind: tool-use\n",
        "    id: id1\n",
        "    name: read-file\n",
        "    input: '{ pathname: \"src/main.rs\" }'\n",
        "  - kind: tool-use\n",
        "    id: id2\n",
        "    name: read-file\n",
        "    input: '{ pathname: \"src/session.rs\" }'\n",
        "  response:\n",
        "    thinking: high\n",
        "    request-tools:\n",
        "    - tool1\n",
        "    - tool2\n",
        "    start-time: 2026-10-31T12:33:00Z\n",
        "    complete-time: 2026-10-31T12:35:00Z\n",
        "    status-code: 200\n",
        "    header-x-ds-trace-id: x-ds-trace-id-1\n",
        "    model: deepseek-flasher\n",
        "    stop-reason: tool_use\n",
        r#"    usage: '{"input_tokens":400,"cache_read_input_tokens":0,"output_tokens":40}'"#, "\n",
    ));

    assert_eq!(serialize_assistant_message(Message {
        id: 5,
        parent_id: 42,
        role: Role::Assistant,
        content: vec![
            ContentBlock::Text(TextBlock{ value: "this file contains...\nand this file...".to_string(), name: None }),
        ],
        request_config: None,
        response_metadata: None,
    }).expect("failed to serialize"), concat!(
        "message-5:\n",
        "  parent-id: 42\n",
        "  role: assistant\n",
        // what's this |-
        "  content: |-\n",
        "    this file contains...\n",
        "    and this file...\n",
    ));
}

#[test]
fn test_event_stream() {
    use std::assert_matches;
    let mut ex = Vec::new();
    // chrome's test case is at
    // https://github.com/chromium/chromium/blob/5774ba7f90c367cf32a17dc65f530d63cd09d01a/third_party/blink/renderer/modules/eventsource/event_source_parser_test.cc

    // single line
    let mut parser = EventStreamParser::new();
    // b"1".into() reports no impl for &[u8;1], but this is ok
    parser.push("data: value1\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "value1");
    // no additional trim
    parser.push("data:   value2   \n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "  value2   ");

    // discard no data
    let mut parser = EventStreamParser::new();
    parser.push("data:\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(None));
    let mut parser = EventStreamParser::new();
    // oh, multiple line data will make data buffer full of \ns, is this spec's empty string?
    parser.push("data: \ndata:\nid:\nevent:\ndata:\ndata: \n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "\n\n\n");

    // cut inside event
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(b""));
    assert_matches!(parser.pull(&mut ex), Ok(None));
    parser.push(Bytes::from_static(b"data:1"));
    assert_matches!(parser.pull(&mut ex), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(&mut ex), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "1");

    // multiple line
    let mut parser = EventStreamParser::new();
    parser.push("data:1\ndata: 234\ndata: 456   \n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "1\n234\n456   ");

    // multiple events, different kinds of eol by the way
    let mut parser = EventStreamParser::new();
    parser.push("data: message1\n\rdata: message2\r\ndata:message2line2\r\n\r\ndata:  message3\rdata:message3line2\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "message1");
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "message2\nmessage2line2");
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == " message3\nmessage3line2");

    // comment and other fields
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n :a field called empty\n  : a field called multiple whitespace\r\r\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(None));
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n  : a field called multiple whitespace\rdata:hello\n\r\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "hello");

    // cjk
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "你好");
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\ndata: せかい\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "你好\nせかい");

    // cut in cjk
    //              0123456   7   8   9   10  11  1213    19  20  21  22  23  24  25  26  27  2829
    let encoded = b"data: \xe4\xbd\xa0\xe5\xa5\xbd\ndata: \xe3\x81\x9b\xe3\x81\x8b\xe3\x81\x84\n\n";
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(&encoded[..10]));
    assert_matches!(parser.pull(&mut ex), Ok(None));
    parser.push(Bytes::from_static(&encoded[10..23]));
    assert_matches!(parser.pull(&mut ex), Ok(None));
    parser.push(Bytes::from_static(&encoded[23..]));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "你好\nせかい");
    // push one byte by one byte
    let mut parser = EventStreamParser::new();
    for b in encoded.into_iter().take(encoded.len() - 1) {
        parser.push(Bytes::copy_from_slice(&[*b]));
        assert_matches!(parser.pull(&mut ex), Ok(None));
    }
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "你好\nせかい");

    // now need to support event
    let mut parser = EventStreamParser::new();
    parser.push("event: delta1\ndata: value1\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.name.as_deref() == Some("delta1") && m.data == "value1");
    parser.push("data: value1.5\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.name.as_deref() == None && m.data == "value1.5");
    parser.push("event: event2\ndata: value2\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.name.as_deref() == Some("event2") && m.data == "value2");

    // overwrite event name
    let mut parser = EventStreamParser::new();
    parser.push("event: delta1\ndata: value1\revent:overwritten\n\n".into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.name.as_deref() == Some("overwritten") && m.data == "value1");
}

#[test]
fn test_event_stream_chat_completion() {
    use std::assert_matches;
    let mut ex = Vec::new();

    // nearly a real data
    let mut parser = EventStreamParser::new();
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" read"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" read"},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" the"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" file"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" for"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" the"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" file"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" for"},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" you"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" you"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tool-call-id-1","type":"function","function":{"name":"read-file","arguments":""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tool-call-id-1","type":"function","function":{"name":"read-file","arguments":""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"name"}}]},"logprobs":null,"finish_reason":null}]"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerp"#,
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"name"}}]},"logprobs":null,"finish_reason":null}]"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(None));

    parser.push(concat!(
        r#"rint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": "}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": "}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/main"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":".rs"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/main"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":".rs"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":427,"#,
        r#"completion_tokens":47,"total_tokens":474,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":427}}"#,
        "\n\n",
        "data: [DONE]",
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":427,"#,
        r#"completion_tokens":47,"total_tokens":474,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":427}}"#,
    ));
    assert_matches!(parser.pull(&mut ex), Ok(Some(m)) if m.data == "[DONE]");
    assert_matches!(parser.pull(&mut ex), Ok(None));

    parser.push("".into());
    assert_matches!(parser.pull(&mut ex), Ok(None));
}

#[test]
fn test_event_stream_messages() {
    let mut ex = Vec::new();

    let full = r#"event: message_start
data: {"type":"message_start","message":{"id":"message-id1","type":"message","role":"assistant","model":"deepseek-flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}}

event: message_stop
data: {"type":"message_stop"}

"#;

    let mut parser = EventStreamParser::new();
    parser.push(full.into());
    let event = parser.pull(&mut ex).expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_start"));
    assert_eq!(event.data, concat!(r#"{"type":"message_start","message":{"id":"message-id1","type":"message","role":"assistant","model":"deepseek-flash","#,
        r#""content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}}}"#));
    let event = parser.pull(&mut ex).expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_start"));
    assert_eq!(event.data, r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#);
    let event = parser.pull(&mut ex).expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("ping"));
    assert_eq!(event.data, r#"{"type":"ping"}"#);
    let event = parser.pull(&mut ex).expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_delta"));
    assert_eq!(event.data, r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}"#);
    let event = parser.pull(&mut ex).expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_stop"));
    assert_eq!(event.data, r#"{"type":"content_block_stop","index":0}"#);
    let event = parser.pull(&mut ex).expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_delta"));
    assert_eq!(event.data, r#"{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}}"#);
    let event = parser.pull(&mut ex).expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_stop"));
    assert_eq!(event.data, r#"{"type":"message_stop"}"#);
    assert!(parser.pull(&mut ex).expect("failed to pull?").is_none());
}
