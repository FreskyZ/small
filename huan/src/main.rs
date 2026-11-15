#![allow(unused_imports)]
use std::collections::{HashMap, HashSet};
use std::fmt::{self, Write as _};
use std::fs;
use std::ops::Not as _;
use anyhow::{Result, bail};
use bytes::{BufMut as _, Bytes, BytesMut};
use chrono::{DateTime, Timelike, Utc};
use clap::Parser as _;
use futures_util::StreamExt;
use reqwest;
use serde::{Serializer, Deserializer, Serialize, Deserialize};
use serde::ser::SerializeMap as _;
use serde::de::{MapAccess, SeqAccess, IgnoredAny, Error as DeserializeError};

mod session;
mod text_repr;
use session::*;

// difference with main content block is tag property name and variant name
// because currently serde don't support multiple serialize/deserialize settings on same type,
// persistant storage want to use kind, tool-use, etc., api have to use type, tool_use, etc.
// it's not very not ok to duplicate the types, because they will eventually be in far away modules
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
enum RequestContentBlock {
    #[serde(rename = "text")]
    Text{
        // name merged into text when converting
        text: String,
    },
    #[serde(rename = "thinking")]
    Think{
        thinking: String,
        signature: String,
    },
    #[serde(rename = "tool_use")]
    ToolUse{
        id: String,
        name: String,
        // this is empty object at content start event,
        // but is incrementally built as string in content delta events,
        // that mean you need this
        input: serde_json::Value,
        #[serde(default, skip_serializing)]
        input_builder: String,
    },
    #[serde(rename = "tool_result")]
    ToolResult{
        tool_use_id: String,
        content: String,
    },
}

#[derive(Debug, Serialize)]
struct RequestMessage {
    role: Role,
    // no need to precisely map plain string to plain string in request object,
    // I guess api backend will still convert plain string format to block schema
    content: Vec<RequestContentBlock>,
}

#[derive(Debug, Serialize)]
struct RequestThinking {
    r#type: String,
}

#[derive(Debug, Serialize)]
struct RequestOutputConfig {
    effort: &'static str,
}

#[derive(Debug, Serialize)]
struct RequestTitle {
    enabled: bool,
}

// json schema specification https://json-schema.org/specification
// specification repository https://github.com/json-schema-org/json-schema-spec
// is a draft at the time of writing, is unexpectedly not ietf rfc while latest draft came out at 2020
// a 800 star json schema library https://docs.rs/jsonschema include spec definition and validation, has its own derive macro
// a 1.4k star json schema library https://docs.rs/schemars can extract json schema from serde derive definitions

#[derive(Debug, Serialize)]
struct ToolDefinition {
    name: &'static str,
    // this is optional, but I guess you should not do that or else the model will imagine a description
    description: &'static str,
    // but for now this is plain json value
    input_schema: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct Request {
    // don't serialize this into request body
    #[serde(skip_serializing)]
    url: reqwest::Url,
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<Vec<RequestContentBlock>>,
    messages: Vec<RequestMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<usize>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<RequestThinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_config: Option<RequestOutputConfig>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<ToolDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<RequestTitle>,
}

fn prepare_request(session: &Session, request_config: &RequestConfig, request_message_id: usize) -> Result<Request> {

    let mut thread = Vec::new();
    let mut next_parent_id = Some(request_message_id);
    while let Some(parent_id) = next_parent_id {
        // unwrap: validated parent id exist
        let parent_message = session.messages.iter().find(|m| m.id == parent_id).unwrap();
        thread.push(parent_message);
        next_parent_id = parent_message.parent_id;
    }

    /* reverse is here */ thread.reverse(); /* reverse is here */

    // already validated parent message role relationship, only need validated last (thread start) message role
    if !thread.is_empty() && thread[0].role.is_assistant() {
        let thread_ids = thread.iter().map(|m| format!("{}({:?})", m.id, m.role)).collect::<Vec<_>>();
        bail!("thread not start with user message, thread: {:?}", thread_ids);
    }

    let base_url = request_config.base_url.as_deref().unwrap_or("https://api.deepseek.com/anthropic");
    let mut url = reqwest::Url::parse(&base_url)?;
    let path_name = std::path::PathBuf::from(url.path()).join("v1/messages");
    let path_name = path_name.to_str().ok_or_else(|| anyhow::anyhow!("failed to create request url?"))?;
    url.set_path(path_name);

    let model = request_config.model.as_deref().unwrap_or("deepseek-flash").to_string();
    let (thinking, output_config) = match &request_config.thinking {
        Thinking::Switch(true) => (Some(RequestThinking{ r#type: "enabled".to_string() }), None),
        Thinking::Switch(false) => (Some(RequestThinking{ r#type: "disabled".to_string() }), None),
        Thinking::Effort(effort) => (None, Some(RequestOutputConfig{ effort: effort })),
    };
    let max_tokens = request_config.max_tokens;
    let title = if request_config.title { Some(RequestTitle{ enabled: true }) } else { None }; 

    let system = session.system_message.as_ref().map(|m| m.content.iter().map(|b| match b {
        ContentBlock::Text{ name: None, value } =>
            RequestContentBlock::Text{ text: value.clone() },
        ContentBlock::Text{ name: Some(name), value } =>
            RequestContentBlock::Text{ text: format!("<{}>{}</{}>", name, value, name) },
        _ => unreachable!("system message content block type"),
    }).collect());
    let messages = thread.into_iter().map(|message| RequestMessage{
        role: message.role,
        content: message.content.iter().map(|b| match b {
            // NOTE these .trim() should be consistent or else cache will invalidate
            ContentBlock::Text{ name: None, value } =>
                RequestContentBlock::Text{ text: value.trim_ascii().to_string() },
            ContentBlock::Text{ name: Some(name), value } =>
                RequestContentBlock::Text{ text: format!("<{}>{}</{}>", name, value.trim_ascii().to_string(), name) },
            ContentBlock::Thinking{ value, signature } =>
                RequestContentBlock::Think{ thinking: value.trim_ascii().to_string(), signature: signature.clone() },
            ContentBlock::ToolUse{ id, name, input } =>
                RequestContentBlock::ToolUse{
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                    input_builder: String::new(),
                },
            ContentBlock::ToolResult{ id, value, .. } =>
                RequestContentBlock::ToolResult{ tool_use_id: id.clone(), content: value.trim_ascii().to_string() },
        }).collect(),
    }).collect();

    // currently deepseek api validate tool name duplicate, don't rely on that
    let all_tools = vec![
        ToolDefinition{
            name: "read-file",
            description: "Read the contents of a file. Can specify a line range to read using start-line and end-line parameter, default to read 400 lines of content start from first line.",
            // now this part have to use json!
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path of the file to read.",
                    },
                    "start-line": {
                        "type": "integer",
                        "description": "Beginning line to read, start from 1, inclusive, default to 1",
                    },
                    "end-line": {
                        "type": "integer",
                        "description": "Ending line to read, start from 1, exclusive, default to 400 lines of content after start-line."
                    },
                },
                "required": ["path"],
            }),
        },
        ToolDefinition{
            name: "edit-file",
            description: "Edit contents of a file. Specify a line range to overwrite, range is left inclusive right exclusive, use same value to insert before the line.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path of the file to write.",
                    },
                    "start-line": {
                        "type": "integer",
                        "description": "Beginning line to overwrite, start from 1, inclusive",
                    },
                    "end-line": {
                        "type": "integer",
                        "description": "Ending line to overwrite, start from 1, exclusive"
                    },
                    "content": {
                        "type": "string",
                        "description": "new content to overwrite"
                    }
                },
                "required": ["path", "start-line", "end-line", "content"],
            }),
        },
        ToolDefinition{
            name: "list-directory",
            description: "List file system entries in directory.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path of the directory to read, if omitted, use workspace directory.",
                    },
                },
            }),
        },
        ToolDefinition{
            name: "run-shell-command",
            description: concat!("Run command in shell synchronously. The command may be audited by user or other mechanism. ",
                "Output may be error, timeout or truncated if it is too long. Avoid dangerous commands and instruct user to determine and execute manually."),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Provide a description to use when the agent prompt user for approval or later to diagnostic unexpected errors.",
                    },
                },
                "required": ["command", "description"],
            }),
        },
        ToolDefinition{
            name: "get-current-time",
            description: "Get current date and time.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "format": {
                        "type": "string",
                        "description": "strftime format specifier, e.g. %Y-%m-%dT%H%M%S%z, default to iso8601",
                    },
                },
            }),
        },
    ];

    let unknown_tool_names =  request_config.tool_names.iter()
        .map(|n| n.as_str())
        .filter(|n| !all_tools.iter().any(|e| &e.name == n)).collect::<Vec<_>>();
    if unknown_tool_names.is_empty().not() {
        bail!("unknown tool names {}", unknown_tool_names.join(","));
    }
    let tools = all_tools.into_iter().filter(|t| request_config.tool_names.iter().any(|n| n == t.name)).collect();

    Ok(Request { url, model, system, messages, thinking, output_config, max_tokens, stream: true, tools, title })
}

fn get_request_display(request: &Request) -> Result<String> {
    let mut b = String::new();

    fn write_content(b: &mut String, blocks: &[RequestContentBlock]) -> Result<()> {
        for block in blocks {
            match block {
                RequestContentBlock::Text{ text } =>
                    writeln!(b, "   {}", LongText(text))?,
                RequestContentBlock::Think{ thinking, signature } =>
                    writeln!(b, "   <think>\n   {}\n   {}", signature, LongText(thinking))?,
                RequestContentBlock::ToolUse{ id, name, input, .. } =>
                    writeln!(b, "   <tool-use>\n   {}({})[{}]", name, input, id)?,
                RequestContentBlock::ToolResult{ tool_use_id, content, .. } =>
                    writeln!(b, "   <tool-result>\n   {}\n   {}", tool_use_id, LongText(content))?,
            }
        }
        Ok(())
    }

    writeln!(b, "request:")?;
    writeln!(b, "url: {}", request.url)?;
    writeln!(b, "model: {}", request.model)?;
    writeln!(b, "thining: {:?}", request.thinking)?;
    writeln!(b, "output config: {:?}", request.output_config)?;
    writeln!(b, "title: {:?}", request.title)?;
    if let Some(max_tokens) = request.max_tokens { writeln!(b, "max tokens: {}", max_tokens)?; }
    writeln!(b, "stream: true")?;
    if let Some(system_message) = &request.system {
        writeln!(b, "system:")?;
        write_content(&mut b, system_message)?;
    }
    for message in &request.messages {
        // id is not that relavent after request resolved thread
        writeln!(b, "{}:", message.role.display())?;
        write_content(&mut b, &message.content)?;
    }
    for tool in &request.tools {
        writeln!(b, "tool: {}", tool.name)?;
    }

    Ok(b)
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

// event stream parser: push bytes, pull events
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
    fn pull(&mut self) -> Result<Option<Event>> {
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
                    // println!("you really have field without value? {:?}", field);
                    (field, &[] as &[u8]) // you need this as to convert from &[{unknown};0] to &[u8]?
                };
                if name.is_empty() {
                    // println!("you really have comment? {:?}: {:?}", name, value);
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
                    // println!("you really have field other than event and data? {:?}: {:?}", name, value);
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlockDelta {
    #[serde(rename = "text_delta")]
    Text{ text: String },
    #[serde(rename = "thinking_delta")]
    Think{ thinking: String },
    #[serde(rename = "signature_delta")]
    Signature{ signature: String },
    #[serde(rename = "input_json_delta")]
    ToolInput{ partial_json: String },
}

// why message_delta event's delta only contains stop reason (and stop sequence)?
#[derive(Debug, Deserialize)]
struct MessageDelta {
    stop_reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DeltaEvent {
    MessageStart{
        message: ResponseMessage,
    },
    ContentBlockStart{
        index: usize,
        content_block: RequestContentBlock,
    },
    ContentBlockDelta{
        index: usize,
        delta: ContentBlockDelta,
    },
    ContentBlockStop{
        index: usize,
    },
    MessageDelta{
        delta: MessageDelta,
        usage: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    MessageStop,
    // document says there will be ping
    Ping,
    // document says there may not be an error event?
    // Error,
}
impl DeltaEvent {
    // print event name without reading data or debug print
    fn name(&self) -> &'static str {
        match self {
            Self::MessageStart{..} => "message_start",
            Self::ContentBlockStart{..} => "content_block_start",
            Self::ContentBlockDelta{..} => "content_block_delta",
            Self::ContentBlockStop{..} => "content_block_stop",
            Self::MessageDelta{..} => "message_delta",
            Self::MessageStop => "message_stop",
            Self::Ping => "ping",
        }
    }
}

// this result itself is not deserialized from text, but many of its
// properties are in message-start event so this need to be deserialized for that
#[derive(Debug, Deserialize, PartialEq)]
struct ResponseMessage {
    id: String,
    // keep to validate constant values
    r#type: String,
    role: String,
    model: String,
    // streaming messages api don't have plain string content
    content: Vec<RequestContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop_reason: Option<String>,
    usage: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
}

struct DeltaAssembler {
    message: ResponseMessage,
    started: bool, // message started
    stopped: bool, // message stopped
    // started and not completed blocks
    blocks: HashMap<usize, RequestContentBlock>,
    // completed blocks, not sure whether will receive blocks by index,
    // so completed blocks still need map and validate index gap after complete
    completed_blocks: HashMap<usize, RequestContentBlock>,
    // try collect errors and continue handling to end of the stream
    errors: Vec<String>,
}
impl DeltaAssembler {

    fn new() -> Self {
        Self {
            // new with default value is easier to use than a mutable Option
            message: ResponseMessage {
                id: String::new(),
                r#type: String::new(),
                role: String::new(),
                model: String::new(),
                content: Vec::new(),
                stop_reason: None,
                usage: serde_json::Value::Null,
                title: None,
            },
            started: false,
            stopped: false,
            blocks: HashMap::new(),
            completed_blocks: HashMap::new(),
            errors: Vec::new(),
        }
    }

    // no expected error, all collected and try continue
    fn push(&mut self, event: Event) {
        // use event.data as message header, it is generally short and distinguishable
        macro_rules! raise { ($($arg:tt)*) => {{ self.errors.push(format!($($arg)*)); }} }

        let Ok(delta_event) = serde_json::from_str::<DeltaEvent>(&event.data)
            // return: cannot continue with overall json parse error
            .map_err(|e| raise!("{}: failed to parse json: {}", event.data, e)) else { return; };
        // accept no event name
        if let Some(name) = event.name && name != delta_event.name() {
            raise!("{}: name and data.type mismatch, {} != {}", event.data, name, delta_event.name());
        }
        // return: no need to action after message stopped
        if self.stopped { raise!("{}: unexpected event after message stopped", event.data); return; }

        match delta_event {
            // ping is allowed anywhere while no action for that
            DeltaEvent::Ping => {},
            // normal first event
            DeltaEvent::MessageStart{ message } if !self.started => {
                self.started = true;
                self.message = message;
                if self.message.r#type != "message" {
                    raise!("{}: message.type is not message", event.data);
                }
                if self.message.role != "assistant" {
                    raise!("{}: message.role is not assistant", event.data);
                }
            },
            DeltaEvent::MessageStart{..} /* if self.started */ =>
                raise!("{}: duplicate message_start event", event.data),
            // use this to reject all other events before started
            e if !self.started =>
                // no return: you can still operate content blocks regardless of message started?
                raise!("{}: unexpected event {} before message_start", event.data, e.name()),

            DeltaEvent::ContentBlockStart { index, content_block } => {
                println!("\nblock_start {} {:?}", index, content_block);
                // check completed first, should not insert if is in completed list while not in active list
                if self.completed_blocks.contains_key(&index) {
                    raise!("{}: block {} started after completed", event.data, index);
                } else if self.blocks.insert(index, content_block).is_some() {
                    raise!("{}: block {} started again", event.data, index);
                }
            },
            DeltaEvent::ContentBlockDelta { index, delta } => {
                if self.completed_blocks.contains_key(&index) {
                    raise!("{}: block {} delta after completed", event.data, index);
                }
                let Some(block) = self.blocks.get_mut(&index) else {
                    // return: cannot continue if cannot find target block to manipulate
                    raise!("{}: block {} delta before start", event.data, index); return;
                };
                match (delta, block) {
                    // std string is not rope, cannot merge 2 owned string together without copy
                    (ContentBlockDelta::Text { text: text_delta }, RequestContentBlock::Text { text }) => {
                        print!("{}", text_delta); text.push_str(&text_delta);
                    },
                    (ContentBlockDelta::Think { thinking: thinking_delta }, RequestContentBlock::Think{ thinking, .. }) => {
                        print!("{}", thinking_delta); thinking.push_str(&thinking_delta);
                    },
                    (ContentBlockDelta::Signature { signature: signature_delta }, RequestContentBlock::Think{ signature, .. }) => {
                        print!("{}", signature_delta); signature.push_str(&signature_delta);
                    },
                    (ContentBlockDelta::ToolInput { partial_json }, RequestContentBlock::ToolUse{ input_builder, .. }) => {
                        print!("{}", partial_json); input_builder.push_str(&partial_json);
                    },
                    (delta, block) => raise!("{}: block delta type mismatch? {:?}, {:?}", event.data, delta, block),
                }
            },
            DeltaEvent::ContentBlockStop{ index } => {
                println!("\nblock_stop {}", index);
                let Some(mut block) = self.blocks.remove(&index) else {
                    // return: cannot continue if cannot find target block to manipulate
                    raise!("{}: block {} stopped before started?", event.data, index); return;
                };
                match &mut block {
                    RequestContentBlock::Text{ text } if text.is_empty() =>
                        raise!("{}: block {} stopped before any content? (1)", event.data, index),
                    RequestContentBlock::Think{ thinking, .. } if thinking.is_empty() =>
                        raise!("{}: block {} stopped before any content? (2)", event.data, index),
                    RequestContentBlock::ToolUse{ input, input_builder, .. } => {
                        if input_builder.is_empty() {
                            raise!("{}: block {} stopped before any content? (3)", event.data, index);
                        } else {
                            match serde_json::from_str(input_builder) {
                                Ok(v) => *input = v,
                                Err(e) => raise!("{}: failed to parse json after tool input content stop: {}", event.data, e),
                            }
                        }
                    },
                    _ => {}, // ok if they are not empty
                }
                self.completed_blocks.insert(index, block);
            },
            DeltaEvent::MessageDelta{ delta, usage, title } => {
                self.message.stop_reason = Some(delta.stop_reason);
                self.message.usage = usage;
                self.message.title = title;
            },
            DeltaEvent::MessageStop => {
                self.stopped = true;
                // don't forget to move blocks into message
                if !self.blocks.is_empty() {
                    raise!("message_stop: some blocks not stopped when message stopped {:?}", self.blocks.keys());
                }
                if self.completed_blocks.is_empty() {
                    raise!("message_stop: while no content block completed?");
                }
                // usize already restricted values >= 0, so compare max and len is enough for find holes
                // unwrap: validated is not empty
                let max_index = self.completed_blocks.keys().max().unwrap();
                if *max_index + 1 > self.completed_blocks.len() {
                    // return: later unwrap relies on validation pass
                    raise!("message_stop: is it possible to have gaps in content block indexes?"); return;
                }
                for index in 0..=*max_index {
                    // unwrap: validated index is continuous start from 0
                    self.message.content.push(self.completed_blocks.remove(&index).unwrap());
                }
            },
        }
    }

    fn end(&mut self) {
        if !self.started {
            self.errors.push("assembler not started when stream end?".to_string());
        }
        if !self.stopped {
            self.errors.push("assembler not stopped when stream end?".to_string());
        }
    }
}

#[derive(clap::Parser)]
#[command(name = "huan", about = "huan cli")]
struct Command {
    #[command(subcommand)]
    subcommand: SubCommand,
}

#[derive(clap::Subcommand)]
enum SubCommand {
    #[command(about = "run a session")]
    Run {
        #[arg(long)]
        not_dry: bool,
        filename: String,
    },
    #[command(about = "migrate something")]
    Migrate,
}

fn migrate() -> Result<()> {
    println!("migrate");

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let command = Command::parse();
    let SubCommand::Run{ filename, not_dry } = command.subcommand else {
        return migrate();
    };
    println!("file name {}", filename);

    let session_original_content = fs::read_to_string(&filename)?;
    let (session, request_config) = text_repr::from_str(&filename, &session_original_content)?;
    print!("{}", session);
    let Some((request_config, request_message_id)) = request_config else { bail!("missing request config, exit"); };
    print!("{}", request_config);

    let request = prepare_request(&session, &request_config, request_message_id)?;
    println!("{}", get_request_display(&request)?);
    if !not_dry { println!("this is dry run, use --not-dry to actually run"); return Ok(()); }
    // return Ok(());

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    let client = reqwest::Client::builder().build()?;
    let request = client
        .post(request.url.clone())
        .header("content-type", "application/json")
        .bearer_auth(api_key)
        .json(&request).build()?;
    // unwrap: provided nanosecond is valid
    let start_time = Utc::now().with_nanosecond(0).unwrap();
    let response = client.execute(request).await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await?;
        bail!("response error {}: {}", status, body);
    }
    let headers = response.headers();
    // NOTE that content-type may be "text/event-stream; charset=utf8"
    // https://www.rfc-editor.org/info/rfc9110/#name-content-type
    // https://www.rfc-editor.org/info/rfc2046/
    // ignore no such header, will that happen?
    if let Some(content_type) = headers.get("content-type") {
        // ignore to str error, how does that happen?
        if let Ok(content_type) = content_type.to_str() {
            // unwrap: split result must have at least 1 element
            let content_type_wo_parameters = content_type.split(';').next().unwrap().trim_ascii();
            if content_type_wo_parameters != "text/event-stream" {
                println!("content-type is not text/event-stream?, {:?}", content_type);
            }
        }
    }

    let mut noticeable_headers = Vec::new();
    for (name, value) in response.headers() {
        // to include unexpected headers, filter by exclude known boring headers
        if matches!(name.as_str(),
            | "server"
            | "vary"
            | "access-control-allow-credentials"
            | "strict-transport-security"
            | "x-content-type-options"
            | "cache-control"
        ) {
            continue;
        }
        match value.to_str() {
            Ok(value) => noticeable_headers.push((name.to_string(), value.to_string())),
            Err(error) => noticeable_headers.push((name.to_string(), format!("{:?}: {}", value.as_bytes(), error))),
        }
    }

    let mut stream = response.bytes_stream();
    let mut parser = EventStreamParser::new();
    let mut assembler = <DeltaAssembler>::new();
    let mut additional = Vec::new();

    let mut chunks = Vec::new();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else { println!("failed to ? a chunk?"); continue };
        chunks.push(String::from_utf8_lossy(chunk.as_ref()).into_owned());
        parser.push(chunk);
        while let Some(event) = parser.pull()? {
            assembler.push(event);
        }
    }
    assembler.end();

    // unwrap: provided nanosecond is valid
    let complete_time = Utc::now().with_nanosecond(0).unwrap();
    let stream_log = chunks.join("\n");
    if let Err(error) = fs::write("stream.log", &stream_log) {
        eprintln!("failed to write stream.log: {}", error);
        eprintln!("{}", stream_log);
    }
    if assembler.errors.is_empty().not() {
        assembler.errors.iter().for_each(|e| eprintln!("{}", e));
        bail!("assembler has errors, abort");
    }

    // println!("{:?}", assembler.message);
    let response_message = assembler.message;
    // unwrap: session.messages is not empty
    let result_message_id = session.messages.iter().map(|m| m.id).max().unwrap() + 1;

    if let Some(title) = response_message.title {
        additional.push(("title".to_string(), serde_json::Value::String(title)));
    }

    let result_message = Message {
        id: result_message_id,
        parent_id: Some(request_message_id),
        role: Role::Assistant,
        request_config: Some(request_config),
        response_metadata: Some(ResponseMetadata {
            start_time,
            status_code: status.as_u16() as usize,
            headers: noticeable_headers,
            complete_time,
            model: response_message.model,
            provider_message_id: response_message.id,
            // unwrap: stop reason is required in message_delta event
            stop_reason: response_message.stop_reason.unwrap(),
            usage: response_message.usage.to_string(),
            additional,
        }),
        content: response_message.content.into_iter().map(|block| match block {
            RequestContentBlock::Text { text } => ContentBlock::Text{ name: None, value: text },
            RequestContentBlock::Think { thinking, signature } => ContentBlock::Thinking{ value: thinking, signature },
            RequestContentBlock::ToolUse { id, name, input, .. } => ContentBlock::ToolUse{ id, name, input },
            RequestContentBlock::ToolResult {..} => unreachable!("tool-result?"),
        }).collect(),
    };

    let result_message = text_repr::to_string(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    println!("write {}", filename);
    fs::write(&filename, output_content)?;

    Ok(())
}

#[test]
fn test_event_stream() {
    use std::assert_matches;
    // chrome's test case is at
    // https://github.com/chromium/chromium/blob/5774ba7f90c367cf32a17dc65f530d63cd09d01a/third_party/blink/renderer/modules/eventsource/event_source_parser_test.cc

    // single line
    let mut parser = EventStreamParser::new();
    // b"1".into() reports no impl for &[u8;1], but this is ok
    parser.push("data: value1\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "value1");
    // no additional trim
    parser.push("data:   value2   \n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "  value2   ");

    // discard no data
    let mut parser = EventStreamParser::new();
    parser.push("data:\n\n".into());
    assert_matches!(parser.pull(), Ok(None));
    let mut parser = EventStreamParser::new();
    // oh, multiple line data will make data buffer full of \ns, is this spec's empty string?
    parser.push("data: \ndata:\nid:\nevent:\ndata:\ndata: \n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "\n\n\n");

    // cut inside event
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(b""));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(b"data:1"));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "1");

    // multiple line
    let mut parser = EventStreamParser::new();
    parser.push("data:1\ndata: 234\ndata: 456   \n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "1\n234\n456   ");

    // multiple events, different kinds of eol by the way
    let mut parser = EventStreamParser::new();
    parser.push("data: message1\n\rdata: message2\r\ndata:message2line2\r\n\r\ndata:  message3\rdata:message3line2\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "message1");
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "message2\nmessage2line2");
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == " message3\nmessage3line2");

    // comment and other fields
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n :a field called empty\n  : a field called multiple whitespace\r\r\n".into());
    assert_matches!(parser.pull(), Ok(None));
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n  : a field called multiple whitespace\rdata:hello\n\r\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "hello");

    // cjk
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好");
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\ndata: せかい\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好\nせかい");

    // cut in cjk
    //              0123456   7   8   9   10  11  1213    19  20  21  22  23  24  25  26  27  2829
    let encoded = b"data: \xe4\xbd\xa0\xe5\xa5\xbd\ndata: \xe3\x81\x9b\xe3\x81\x8b\xe3\x81\x84\n\n";
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(&encoded[..10]));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(&encoded[10..23]));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(&encoded[23..]));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好\nせかい");
    // push one byte by one byte
    let mut parser = EventStreamParser::new();
    for b in encoded.into_iter().take(encoded.len() - 1) {
        parser.push(Bytes::copy_from_slice(&[*b]));
        assert_matches!(parser.pull(), Ok(None));
    }
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好\nせかい");

    // now need to support event
    let mut parser = EventStreamParser::new();
    parser.push("event: delta1\ndata: value1\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == Some("delta1") && m.data == "value1");
    parser.push("data: value1.5\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == None && m.data == "value1.5");
    parser.push("event: event2\ndata: value2\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == Some("event2") && m.data == "value2");

    // overwrite event name
    let mut parser = EventStreamParser::new();
    parser.push("event: delta1\ndata: value1\revent:overwritten\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == Some("overwritten") && m.data == "value1");
}

#[test]
fn test_event_stream_chat_completion() {
    use std::assert_matches;

    // nearly a real data
    let mut parser = EventStreamParser::new();
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" read"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
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
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" the"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" file"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
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
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" you"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tool-call-id-1","type":"function","function":{"name":"read-file","arguments":""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
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
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"name"}}]},"logprobs":null,"finish_reason":null}]"#,
    ));
    assert_matches!(parser.pull(), Ok(None));

    parser.push(concat!(
        r#"rint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": "}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
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
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/main"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
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
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
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
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":427,"#,
        r#"completion_tokens":47,"total_tokens":474,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":427}}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "[DONE]");
    assert_matches!(parser.pull(), Ok(None));

    parser.push("".into());
    assert_matches!(parser.pull(), Ok(None));
}

#[test]
fn test_event_stream_messages() {

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
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_start"));
    assert_eq!(event.data, concat!(r#"{"type":"message_start","message":{"id":"message-id1","type":"message","role":"assistant","model":"deepseek-flash","#,
        r#""content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}}}"#));
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_start"));
    assert_eq!(event.data, r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("ping"));
    assert_eq!(event.data, r#"{"type":"ping"}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_delta"));
    assert_eq!(event.data, r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_stop"));
    assert_eq!(event.data, r#"{"type":"content_block_stop","index":0}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_delta"));
    assert_eq!(event.data, r#"{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_stop"));
    assert_eq!(event.data, r#"{"type":"message_stop"}"#);
    assert!(parser.pull().expect("failed to pull?").is_none());
}

#[test]
fn test_assembler() {

    let mut parser = EventStreamParser::new();
    let mut assembler = DeltaAssembler::new();

    for chunk in [
        b"event: message_start\n" as &[u8],
        br#"data: {"type":"message_start","message":{"id":"e6ef6a63-a078-4f53-a73b-38c8d1d46310","type":"message","role":"assistant","model":"deepseek-flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}}}"#,
        b"\n\n",
        b"event: content_block_start\n",
        br#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
        b"\n\n",
        b"event: ping\n",
        br#"data: {"type":"ping"}"#,
        b"\n\n",
        b"event: content_block_delta\n",
        br#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}"#,
        b"\n\n",
        b"event: content_block_stop\n",
        br#"data: {"type":"content_block_stop","index":0}"#,
        b"\n\n",
        b"event: message_delta\n",
        br#"data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}}"#,
        b"\n\n",
        b"event: message_stop\n",
        br#"data: {"type":"message_stop"}"#,
        b"\n\n",
    ].map(|c| Bytes::from_static(c)) {
        parser.push(chunk);
        while let Some(event) = parser.pull().expect("parser pull failed") {
            assembler.push(event);
        }
    }
    assert!(assembler.started);
    assert!(assembler.stopped);
    assert_eq!(assembler.errors, Vec::<String>::new());
    assert_eq!(assembler.message, ResponseMessage {
        id: "e6ef6a63-a078-4f53-a73b-38c8d1d46310".to_string(),
        r#type: "message".to_string(),
        role: "assistant".to_string(),
        model: "deepseek-flash".to_string(),
        content: vec![
            RequestContentBlock::Text{ text: "Hello!".to_string() },
        ],
        stop_reason: Some("end_turn".to_string()),
        usage: serde_json::json!({"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}),
        title: None,
    });

    // TODO signature delta is one delta event
}
