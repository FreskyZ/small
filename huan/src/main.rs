use std::fs;
use anyhow::{Context as _, Result, bail};
use bytes::{BufMut as _, Bytes, BytesMut};
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
    // TODO maybe add a name to textblock to render as <name>content</name>
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

    // TODO validate
    // no duplicate id, parent id exists, tool-call and reasoning only in assistant, user message either no tool-result or all tool-result

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

struct EventStreamParser {
    buffer: BytesMut,
    position: usize,
    current_data: BytesMut,
}
impl EventStreamParser {
    fn new() -> Self {
        Self {
            buffer: BytesMut::with_capacity(1024),
            position: 0,
            current_data: BytesMut::with_capacity(1024),
        }
    }

    fn push(&mut self, bytes: Bytes) {
        self.buffer.extend_from_slice(&bytes);
    }
    // only return event.data as llm apis do not use id and type properties
    // no expected error yet, still return Result in case needed in future
    fn pull(&mut self, response_metadata: &mut Vec<(String, serde_yaml_ng::Value)>) -> Result<Option<String>> {
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
                let result_data = self.current_data.split_off(0).to_vec();
                // according to spec, do not dispatch no data event
                // // from_utf8_lossy_owned is super new rust 1.99 function
                return if result_data.is_empty() { Ok(None) } else { Ok(Some(String::from_utf8_lossy_owned(result_data))) };
            } else {
                // field without eol
                let field = &self.buffer[self.position..eol_index.0];
                self.position = eol_index.1 + 1;
                let (name, value) = if let Some(colon_index) = field.iter().position(|b| *b == b':') {
                    // note the result value may be empty
                    (&field[..colon_index], &field[colon_index + 1..])
                } else {
                    if !response_metadata.iter().any(|(k, _)| k == "event-stream-parser-full-name-field") {
                        response_metadata.push((
                            "event-stream-parser-full-name-field".to_string(),
                            serde_yaml_ng::Value::String(format!("you really have this? {:?}", field))));
                    }
                    (field, &[] as &[u8]) // you need this as to convert from &[{unknown};0] to &[u8]?
                };
                if name.is_empty() {
                    if !response_metadata.iter().any(|(k, _)| k == "event-stream-parser-comment-field") {
                        response_metadata.push((
                            "event-stream-parser-comment-field".to_string(),
                            serde_yaml_ng::Value::String(format!("you really have comment? {:?}: {:?}", name, value))));
                    }
                } else if name == b"data" {
                    // according to spec, remove one ascii whitespace from beginning of value
                    let value = if !value.is_empty() && value[0] == b' ' { &value[1..] } else { value };
                    self.current_data.extend_from_slice(value);
                    // according to spec, join data lines by single lf regardless of actual eol
                    self.current_data.put_u8(b'\n');
                } else {
                    if !response_metadata.iter().any(|(k, _)| k == "event-stream-parser-non-data-field") {
                        response_metadata.push((
                            "event-stream-parser-non-data-field".to_string(),
                            serde_yaml_ng::Value::String(format!("you really have non data field? {:?}: {:?}", name, value))));
                    }
                }
            }
        }
    }
}

// NOT this https://www.rfc-editor.org/info/rfc6902/
fn merge_delta(result: &mut serde_json::Value, delta: serde_json::Value) -> Result<()> {

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    
    let input_text = fs::read_to_string("example-input.yml")?;
    let session = read_session(&input_text)?;
    println!("session name {}", session.name);
    println!("{:?}", session);

    let mut messages = Vec::new();
    for message in &session.messages {
        match message.role {
            Role::System => {
                let mut content = String::new();
                for content_block in &message.content {
                    let ContentBlock::Content(TextBlock{ value }) = content_block else {
                        panic!("how do you put non content content in system message?");
                    };
                    content.push_str(value);
                }
                messages.push(json!({ "role": "system", "content": content }));
            },
            Role::User => {
                let mut content = String::new();
                for (content_index, content_block) in message.content.iter().enumerate() {
                    if let ContentBlock::Content(TextBlock{ value }) = content_block {
                        content.push_str(value);
                    } else if let ContentBlock::ToolResult(ToolResultBlock { id, value, .. }) = content_block {
                        messages.push(json!({ "role": "tool", "tool_call_id": id, "content": value }));
                    } else {
                        panic!("how do you put reasoning/toolcall content in user message?");
                    }
                }
                if !content.is_empty() {
                    messages.push(json!({ "role": "user", "content": content }));
                }
            },
            Role::Assistant => {
                let mut content = String::new();
                let mut tool_calls = Vec::new();
                for (content_index, content_block) in message.content.iter().enumerate() {
                    if let ContentBlock::Content(TextBlock{ value }) = content_block {
                        content.push_str(value);
                    } else if let ContentBlock::ToolCall(ToolCallBlock{ id, name, arguments }) = content_block {
                        tool_calls.push(json!({
                            "index": content_index,
                            "id": id, 
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": arguments,
                            },
                        }));
                    } else if let ContentBlock::Reasoning(_) = content_block {
                        // don't forget thinking content is not in request
                    } else {
                        panic!("how do you put toolresult content in assistant message?");
                    }
                }
                if tool_calls.is_empty() {
                    messages.push(json!({ "role": "assistant", "content": content }));
                } else {
                    messages.push(json!({ "role": "assistant", "content": content, "tool_calls": tool_calls }));
                }
            },
        }
    }
    println!("{:?}", messages);

    let tools = json!([{
        "type": "function", "function": {
        "name": "read-file",
        "description": "Read the contents of a file. Line numbers are 1-indexed. This tool will truncate its output at 2000 lines and may be called repeatedly with offset and limit parameters to read larger files in chunks. Binary files use offset/limit as byte offsets.",
        "parameters": {
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
    } }]);
    println!("{:?}", tools);

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

#[test]
fn test_decode() {
    use std::assert_matches;
    let mut rm = Vec::new();
    // chrome's test case is at
    // https://github.com/chromium/chromium/blob/5774ba7f90c367cf32a17dc65f530d63cd09d01a/third_party/blink/renderer/modules/eventsource/event_source_parser_test.cc

    // single line
    let mut parser = EventStreamParser::new();
    // b"1".into() reports no impl for &[u8;1], but this is ok
    parser.push("data: value1\n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "value1");
    // no additional trim
    parser.push("data:   value2   \n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "  value2   ");

    // discard no data
    let mut parser = EventStreamParser::new();
    parser.push("data:\n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(None));
    let mut parser = EventStreamParser::new();
    // oh, multiple line data will make data buffer full of \ns, is this spec's empty string?
    parser.push("data: \ndata:\nid:\nevent:\ndata:\ndata: \n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "\n\n\n");

    // cut inside event
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(b""));
    assert_matches!(parser.pull(&mut rm), Ok(None));
    parser.push(Bytes::from_static(b"data:1"));
    assert_matches!(parser.pull(&mut rm), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(&mut rm), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "1");

    // multiple line
    let mut parser = EventStreamParser::new();
    parser.push("data:1\ndata: 234\ndata: 456   \n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "1\n234\n456   ");

    // multiple events, different kinds of eol by the way
    let mut parser = EventStreamParser::new();
    parser.push("data: message1\n\rdata: message2\r\ndata:message2line2\r\n\r\ndata:  message3\rdata:message3line2\n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "message1");
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "message2\nmessage2line2");
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == " message3\nmessage3line2");

    // comment and other fields
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n :a field called empty\n  : a field called multiple whitespace\r\r\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(None));
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n  : a field called multiple whitespace\rdata:hello\n\r\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "hello");

    // cjk
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "你好");
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\ndata: せかい\n\n".into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "你好\nせかい");

    // cut in cjk
    //              0123456   7   8   9   10  11  1213    19  20  21  22  23  24  25  26  27  2829
    let encoded = b"data: \xe4\xbd\xa0\xe5\xa5\xbd\ndata: \xe3\x81\x9b\xe3\x81\x8b\xe3\x81\x84\n\n";
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(&encoded[..10]));
    assert_matches!(parser.pull(&mut rm), Ok(None));
    parser.push(Bytes::from_static(&encoded[10..23]));
    assert_matches!(parser.pull(&mut rm), Ok(None));
    parser.push(Bytes::from_static(&encoded[23..]));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "你好\nせかい");
    // push one byte by one byte
    let mut parser = EventStreamParser::new();
    for b in encoded.into_iter().take(encoded.len() - 1) {
        parser.push(Bytes::copy_from_slice(&[*b]));
        assert_matches!(parser.pull(&mut rm), Ok(None));
    }
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "你好\nせかい");
}

#[test]
fn test_decode_kind_of_real() {
    use std::assert_matches;
    let mut rm = Vec::new();

    // nearly a real data
    let mut parser = EventStreamParser::new();
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" read"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
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
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" the"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" file"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
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
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" you"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tool-call-id-1","type":"function","function":{"name":"read-file","arguments":""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
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
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"name"}}]},"logprobs":null,"finish_reason":null}]"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(None));

    parser.push(concat!(
        r#"rint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": "}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
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
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/main"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
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
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
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
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":427,"#,
        r#"completion_tokens":47,"total_tokens":474,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":427}}"#,
    ));
    assert_matches!(parser.pull(&mut rm), Ok(Some(m)) if m == "[DONE]");
    assert_matches!(parser.pull(&mut rm), Ok(None));

    parser.push("".into());
    assert_matches!(parser.pull(&mut rm), Ok(None));
}
