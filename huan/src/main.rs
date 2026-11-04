use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use anyhow::{Context as _, Result, anyhow, bail};
use bytes::{BufMut as _, Bytes, BytesMut};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use reqwest;
use serde::{Serializer, Deserializer, Serialize, Deserialize};
use serde::ser::SerializeMap as _;
use serde::de::{MapAccess, SeqAccess, IgnoredAny, Error as DeserializeError};

// // preceed j makes it looks like java library
use serde_json::Value as JValue;
type JMap = serde_json::Map<String, JValue>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
enum Role {
    #[serde(rename = "user")]
    User,
    #[serde(rename = "assistant")]
    Assistant,
}
impl Role {
    // why do serde custom default require a ()?
    fn assistant() -> Self { Self::Assistant }

    fn is_user(&self) -> bool { matches!(self, Role::User) }
    fn is_assistant(&self) -> bool { matches!(self, Role::Assistant) }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum ContentBlock {
    Text{
        // group text chunks by name
        // will not be created for returned assistant message
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        value: String,
    },
    // think is shorter than thinking and reasoning
    Think{
        value: String,
        #[serde(skip)]
        signature: String,
    },
    ToolUse{ 
        id: String,
        name: String,
        input: String,
    },
    ToolResult{
        id: String,
        value: String,
        // tool execution metadata, logs, etc.
        // custom deserialize function is the correct way to skip deserializing while allow the name with deny_unknown_fields
        #[serde(default, deserialize_with = "skip_deserializing_while_allow_name")]
        metadata: Vec<(String, String)>,
    },
}
// you don't need explicit std::result::Result when imported anyhow Result?
fn skip_deserializing_while_allow_name<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
    T: Default,
    D: Deserializer<'de>,
{
    IgnoredAny::deserialize(deserializer)?;
    Ok(T::default())
}

#[derive(Serialize)]
// untagged's error message is not clear if anything not match content block structure
// #[serde(untagged)]
// what's the effect of deny_unknown_fields here?
#[serde(untagged, deny_unknown_fields)]
enum Content {
    String(String),
    Blocks(Vec<ContentBlock>),
}
// transparent
impl fmt::Debug for Content {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::String(v) => write!(f, "{:?}", v),
            Self::Blocks(v) => write!(f, "{:?}", v),
        }
    }
}
// use this because untagged's error message is not clear if anything not match content block structure
impl<'de> Deserialize<'de> for Content {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Content;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("plain string or content blocks")
            }
            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> where E: DeserializeError {
                Ok(Content::String(v.to_string()))
            }
            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error> where A: SeqAccess<'de> {
                let mut results = Vec::new();
                while let Some(element) = seq.next_element::<ContentBlock>()? {
                    results.push(element);
                }
                Ok(Content::Blocks(results))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

#[derive(Serialize, Deserialize)]
// what's the effect of deny_unknown_fields here?
#[serde(untagged, deny_unknown_fields)]
enum ThinkingMode {
    Switch(bool),
    // low, high, max
    Effort(String),
}
// currently you cannot #[default] on the variant and expect default into variant fields
impl Default for ThinkingMode {
    fn default() -> Self {
        Self::Switch(false)
    }
}
// transparent
impl fmt::Debug for ThinkingMode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Switch(v) => write!(f, "{:?}", v),
            Self::Effort(v) => write!(f, "{:?}", v),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct RequestConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    // default to disabled
    #[serde(default)]
    think: ThinkingMode,
    #[serde(rename = "tools")]
    tool_names: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<usize>,
}

#[derive(Debug)]
struct ResponseMetadata {
    // request time
    start_time: DateTime<Utc>,
    // response status and headers
    status_code: usize,
    headers: Vec<(String, String)>,
    // response stream complete time
    complete_time: DateTime<Utc>,
    // result model
    model: String,
    stop_reason: String,
    // save json text here, currently no need to parse them precisely, actually
    // you can use postgresql's rich json functionality to query values if need
    usage: String,
    // extra information if useful
    extra: Vec<(String, String)>,
}
// flatten header+extra, note that serde flatten don't support ordered map types like vec<(string, string)>
impl Serialize for ResponseMetadata {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(Some(7 + self.headers.len() + self.extra.len()))?;
        map.serialize_entry("start-time", &self.start_time)?;
        map.serialize_entry("status-code", &self.status_code)?;
        for (key, value) in &self.headers {
            map.serialize_entry(&format!("header-{}", key), value)?;
        }
        map.serialize_entry("complete-time", &self.complete_time)?;
        map.serialize_entry("model", &self.model)?;
        map.serialize_entry("stop-reason", &self.stop_reason)?;
        map.serialize_entry("usage", &self.usage)?;
        for (key, value) in &self.extra {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

// system message don't have all other properties
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SystemMessage {
    content: Content,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    #[serde(skip)]
    id: usize,
    #[serde(default, rename = "parent-id")]
    parent_id: usize,
    role: Role,
    content: Content,
    #[serde(default, rename = "request", skip_serializing_if = "Option::is_none", deserialize_with = "skip_deserializing_while_allow_name")]
    request_config: Option<RequestConfig>,
    #[serde(default, rename = "response", skip_serializing_if = "Option::is_none", deserialize_with = "skip_deserializing_while_allow_name")]
    response_metadata: Option<ResponseMetadata>,
}

// Message::serialize serializes message without id, this put id in key
fn serialize_message(message: &Message) -> Result<String> {

    let mut buffer = Vec::with_capacity(128);
    let mut serializer = serde_yaml_ng::Serializer::new(&mut buffer);
    let mut map = serializer.serialize_map(Some(1))?;
    map.serialize_entry(&format!("message-{}", message.id), &message)?;
    map.end()?;
    Ok(String::from_utf8(buffer)?)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct RequestConfigAndId {
    message_id: usize,
    parent_message_id: usize,
    #[serde(flatten)]
    config: RequestConfig,
}

// this is not deserialize to handle special message id naming convention
#[derive(Debug)]
struct Session {
    name: String,
    system_message: Option<SystemMessage>,
    // this is a flattened array of message tree structure, items reference parent node by id and parent id
    messages: Vec<Message>,
    request_config: Option<RequestConfigAndId>,
}

impl<'de> Deserialize<'de> for Session {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Session;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("session")
            }
            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
                // for this design of accessor you have to declare all fields in advance
                let mut name = None;
                let mut system_message = None;
                let mut messages = Vec::new();
                let mut request_config = None;
                while let Some(key) = map.next_key::<&str>()? {
                    match key {
                        "name" => name = Some(map.next_value()?),
                        "request" => request_config = Some(map.next_value()?),
                        "system" => system_message = Some(map.next_value()?),
                        message_key if let Some(message_id) = message_key.strip_prefix("message-") => {
                            // "-2" cannot parse as u64 if you didn't notice
                            let message_id = message_id.parse().map_err(|_| DeserializeError
                                ::invalid_value(serde::de::Unexpected::Str(message_id), &"positive integer"))?;
                            // so this actually only checks 0
                            if message_id <= 0 {
                                return Err(DeserializeError::invalid_value(
                                    serde::de::Unexpected::Unsigned(message_id), &"positive value"));
                            }
                            let mut message = map.next_value::<Message>()?;
                            message.id = message_id as usize;
                            messages.push(message);
                        },
                        // allow some other properties while don't actually read them
                        "create-time" => { map.next_value::<IgnoredAny>()?; },
                        other => return Err(DeserializeError::unknown_field(other, &["name", "message-*", "request"])),
                    }
                }
                let name = name.ok_or_else(|| DeserializeError::missing_field("name"))?;
                if messages.is_empty() { return Err(DeserializeError::missing_field("message-*")); }
                Ok(Session{ name, system_message, messages, request_config })
            }
        }
        deserializer.deserialize_map(Visitor)
    }
}

fn validate_session(session: &Session) -> Result<()> {

    // x. missing property or primitive type mismatch is rejected by basic deserializing
    // x. multiple system message is rejected by yaml parse
    // 1. system message don't have other content block type
    // x. multiple request config is rejected by yaml parse
    // 2. duplicate message id, include request config
    // 2. parent id exist, include request config
    // 3. user message don't have think and tool use blocks
    // 4. assistant message don't have tool result blocks

    let mut has_error = false;
    macro_rules! raise { ($($arg:tt)*) => {{ has_error = true; println!($($arg)*); }} }

    if let Some(system_message) = &session.system_message {
        if let Content::Blocks(blocks) = &system_message.content {
            for (block_index, block) in blocks.iter().enumerate() {
                match block {
                    ContentBlock::Text{..} => {}, // ok
                    ContentBlock::Think{..} =>
                        raise!("system message: content#{}: kind: unknown variant think, expect text", block_index),
                    ContentBlock::ToolUse{..} =>
                        raise!("system message: content#{}: kind: unknown variant tool-use, expect text", block_index),
                    ContentBlock::ToolResult{..} =>
                        raise!("system message: content#{}: kind: unknown variant tool-result, expect text", block_index),
                }
            }
        }
    }

    let mut message_ids = HashSet::new();
    for message in &session.messages {
        if !message_ids.insert(message.id) {
            raise!("message-{}: duplicate message id", message.id);
        }
        if message.id == message.parent_id {
            raise!("message-{}: parent id cannot be same as id", message.id);
        } else if message.parent_id > 0 {
            if let Some(parent_message) = session.messages.iter().find(|m| m.id == message.parent_id) {
                if !matches!((&message.role, &parent_message.role), (Role::User,  Role::Assistant) | (Role::Assistant, Role::User)) {
                    raise!("message-{}: unexpected parent message role relationship", message.id);
                }
            } else {
                raise!("message-{}: parent-id {} not exist", message.id, message.parent_id);
            }
        }
        if let Content::Blocks(blocks) = &message.content {
            for (block_index, block) in blocks.iter().enumerate() {
                match block {
                    ContentBlock::Text{ name, .. } if message.role.is_assistant() && name.is_some() =>
                        raise!("message-{}: content#{}: unknown field name, expect kind, value for assistant message", message.id, block_index),
                    ContentBlock::Think{..} if message.role.is_user() => 
                        raise!("message-{}: content#{}: kind: unknown variant think, expect text, tool-result for user message", message.id, block_index),
                    ContentBlock::ToolUse{..} if message.role.is_user() =>
                        raise!("message-{}: content#{}: kind: unknown variant think, expect text, tool-result for user message", message.id, block_index),
                    ContentBlock::ToolResult{..} if message.role.is_assistant() =>
                        raise!("message-{}: content#{}: kind: unknown variant tool-result, expect text, think, tool-use for assistant message", message.id, block_index),
                    ContentBlock::ToolResult{ id: result_id, ..} => {
                        if let Some(parent_message) = session.messages.iter().find(|m| m.id == message.parent_id) {
                            if let Content::Blocks(blocks) = &parent_message.content {
                                if !blocks.iter().any(|p| matches!(p, ContentBlock::ToolUse{ id: use_id, .. } if use_id == result_id)) {
                                    raise!("message-{}: expect tool result id find in parent message's tool use blocks", message.id);
                                }
                            } else {
                                raise!("message-{}: expect tool result id find in parent message's tool use blocks (1)", message.id);
                            }
                        } else {
                            raise!("message-{}: expect parent-id exist when there is tool-result block", message.id);
                        }
                    },
                    _ => {}, // others are ok
                }
            }
        }
    }
    
    if let Some(request_config) = &session.request_config {
        if request_config.message_id <= 0 {
            raise!("request config: message-id: invalid value 0, expect positive value");
        }
        if !message_ids.insert(request_config.message_id) {
            raise!("request config: duplicate message id {}", request_config.message_id);
        }
        if request_config.message_id == request_config.parent_message_id {
            raise!("request config: parent id cannot be same as message id");
        } else if request_config.parent_message_id > 0 {
            if let Some(parent_message) = session.messages.iter().find(|m| m.id == request_config.parent_message_id) {
                if !matches!(parent_message.role, Role::User) {
                    raise!("request config: unexpected parent message role relationship");
                }
            } else {
                raise!("request config: parent-id {} not exist", request_config.parent_message_id);
            }
        }

        if let Some(model) = &request_config.config.model {
            if !matches!(model.as_str(), "deepseek-flash" | "deepseek-v4-pro") {
                raise!("request config: unknown model name, expect deepseek-flash and deepseek-v4-pro");
            }
        }
        if let ThinkingMode::Effort(effort) = &request_config.config.think {
            if !matches!(effort.as_str(), "low" | "high" | "max") {
                raise!("request config: unknown thinking mode, expect true/false/low/high/max");
            }
        }
        if let Some(max_tokens) = request_config.config.max_tokens {
            if max_tokens <= 0 {
                raise!("invalid max-tokens, expect positive value");
            }
        }
    }

    if has_error { bail!("has validation errors"); }
    Ok(())
}

// difference with contentblock1 is tag property name and variant name
// because currently serde don't support serialize/deserialize use different tags
// persistant storage want to use kind, tool-use, etc., api have to use type, tool_use, etc.
// and I'm lazy to really manually implement the serialize or deserialize implementation,
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
        // thinking content is required for tool use turns to let model continue thinking,
        // signature is required in original api, it is currently not required in deepseek compatible api,
        // but always provide the signature should be simpler and easier to explain
        thinking: String,
        signature: String,
    },
    #[serde(rename = "tool_use")]
    ToolUse{ 
        id: String,
        name: String,
        input: String,
    },
    #[serde(rename = "tool_result")]
    ToolResult{
        tool_use_id: String,
        content: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum RequestMessageContent {
    String(String),
    Blocks(Vec<RequestContentBlock>),
}
// transparent
impl fmt::Debug for RequestMessageContent {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::String(v) => write!(f, "{:?}", v),
            Self::Blocks(v) => write!(f, "{:?}", v),
        }
    }
}

#[derive(Debug, Serialize)]
struct RequestMessageRoleAndContent {
    role: Role,
    content: RequestMessageContent,
}

#[derive(Debug, Serialize)]
struct RequestThinking {
    r#type: String,
}

#[derive(Debug, Serialize)]
struct RequestOutputConfig {
    effort: String,
}

// json schema specification https://json-schema.org/specification
// specification repository https://github.com/json-schema-org/json-schema-spec
// is a draft at the time of writing, is unexpectedly not ietf rfc while latest draft came out at 2020
// a 800 star json schema library https://docs.rs/jsonschema include spec definition and validation, has its own derive macro
// a 1.4k star json schema library https://docs.rs/schemars can extract json schema from serde derive definitions

#[derive(Debug, Serialize)]
struct ToolDefinition {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    // but for now this is plain json value
    input_schema: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct Request {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<RequestMessageContent>,
    messages: Vec<RequestMessageRoleAndContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<usize>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<RequestThinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_config: Option<RequestOutputConfig>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<ToolDefinition>,
}

// consume session and return (target message, request body)
fn prepare_request(session: &Session) -> Result<Request> {

    let Some(request_config) = &session.request_config else { bail!("missing request config") };

    let mut thread = Vec::new();
    let mut parent_id = request_config.parent_message_id;
    while parent_id != 0 {
        // unwrap: validated parent id exist
        let parent_message = session.messages.iter().find(|m| m.id == parent_id).unwrap();
        thread.push(parent_message);
        parent_id = parent_message.parent_id;
    }

    /* reverse is here */ thread.reverse(); /* reverse is here */

    // already validated parent message role relationship, only need validated last (thread start) message role
    if !thread.is_empty() && thread[0].role.is_assistant() {
        let thread_ids = thread.iter().map(|m| format!("{}({:?})", m.id, m.role)).collect::<Vec<_>>();
        bail!("thread not start with user message, thread: {:?}", thread_ids);
    }

    let model = request_config.config.model.as_deref().unwrap_or("deepseek-flash").to_string();
    let (thinking, output_config) = match &request_config.config.think {
        ThinkingMode::Switch(true) => (Some(RequestThinking{ r#type: "enabled".to_string() }), None),
        ThinkingMode::Switch(false) => (Some(RequestThinking{ r#type: "disabled".to_string() }), None),
        ThinkingMode::Effort(effort) => (None, Some(RequestOutputConfig{ effort: effort.clone() })),
    };
    let max_tokens = request_config.config.max_tokens;

    let system = session.system_message.as_ref().map(|m| match &m.content {
        Content::String(value) => RequestMessageContent::String(value.clone()),
        Content::Blocks(blocks) => RequestMessageContent::Blocks(blocks.iter().map(|b| match b {
            ContentBlock::Text{ name: None, value } => 
                RequestContentBlock::Text{ text: value.clone() },
            ContentBlock::Text{ name: Some(name), value } => 
                RequestContentBlock::Text{ text: format!("<{}>{}</{}>", name, value, name) },
            _ => unreachable!("system message content block type"),
        }).collect()),
    });
    let messages = thread.into_iter().map(|message| RequestMessageRoleAndContent{
        role: message.role,
        content: match &message.content {
            Content::String(value) => RequestMessageContent::String(value.clone()),
            Content::Blocks(blocks) => RequestMessageContent::Blocks(blocks.iter().map(|b| match b {
                ContentBlock::Text{ name: None, value } => 
                    RequestContentBlock::Text{ text: value.clone() },
                ContentBlock::Text{ name: Some(name), value } => 
                    RequestContentBlock::Text{ text: format!("<{}>{}</{}>", name, value, name) },
                // if you have learned that reasoning text don't need to be send in message history,
                // it is required for tool calling turns to allow the model to "continue thinking",
                // additionally, a/ messages api want to validate thinking signature, although deepseek
                // document currently don't require the signature, the simpler way is to always send
                ContentBlock::Think{ value, signature } =>
                    RequestContentBlock::Think{ thinking: value.clone(), signature: signature.clone() },
                ContentBlock::ToolUse{ id, name, input } =>
                    RequestContentBlock::ToolUse{ id: id.clone(), name: name.clone(), input: input.clone() },
                ContentBlock::ToolResult{ id, value, .. } =>
                    RequestContentBlock::ToolResult{ tool_use_id: id.clone(), content: value.clone() },
            }).collect()),
        },
    }).collect();

    let tools = vec![
        ToolDefinition{
            name: "read-file".to_string(),
            description: Some(concat!("Read the contents of a file. Line numbers are 1-indexed. This tool will truncate its output at 2000 lines", 
                " and may be called repeatedly with offset and limit parameters to read larger files in chunks. Binary files use offset/limit as byte offsets.").to_string()),
            // now this part have to use json!
            input_schema: serde_json::json!({
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
            }),
        }
    ];

    Ok(Request { model, system, messages, thinking, output_config, max_tokens, stream: true, tools })
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
                    extra.push(format!("you really have field without value? {:?}", field));
                    (field, &[] as &[u8]) // you need this as to convert from &[{unknown};0] to &[u8]?
                };
                if name.is_empty() {
                    extra.push(format!("you really have comment? {:?}: {:?}", name, value));
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
                    extra.push(format!("you really have field other than event and data? {:?}: {:?}", name, value));
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum DeltaContentBlock {
    #[serde(rename = "text_delta")]
    Text{ text: String },
    #[serde(rename = "thinking_delta")]
    Think{ thinking: String },
    #[serde(rename = "signature_delta")]
    Signature{ signature: String },
    #[serde(rename = "input_json_delta")]
    ToolInput{ partial_json: String },
}
#[derive(Debug, Deserialize)]
struct DeltaStopReason {
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
        delta: DeltaContentBlock,
    },
    ContentBlockStop{
        index: usize,
    },
    MessageDelta{
        delta: DeltaStopReason,
        usage: serde_json::Value,
    },
    MessageStop,
    // document says there will be ping
    Ping,
    // document says there may be no error event?
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
}

struct DeltaAssembler {
    message: ResponseMessage,
    // started blocks
    blocks: HashMap<usize, RequestContentBlock>,
    // completed blocks, not sure whether will receive blocks by index,
    // so completed blocks still need map and validate index gap after complete
    completed_blocks: HashMap<usize, RequestContentBlock>,
    stopped: bool,
}
impl DeltaAssembler {

    // parse json and validate event.name is same as event.data.type
    fn parse_event(event: Event) -> Result<DeltaEvent> {
        let data: DeltaEvent = serde_json::from_str(&event.data)?;
        if let Some(name) = event.name && name != data.name() {
            bail!("event.name and event.data.type mismatch, {} != {}", name, data.name());
        }
        Ok(data)
    }

    // try create with message_start event
    // return None if is expected ping event, return Err if json parse error or other event types
    fn try_new(event: Event) -> Result<Option<Self>> {
        let event = Self::parse_event(event)?;
        match event {
            DeltaEvent::Ping => Ok(None),
            DeltaEvent::MessageStart { message } => Ok(Some(Self{
                message,
                blocks: HashMap::new(),
                completed_blocks: HashMap::new(),
                stopped: false,
            })),
            e => bail!("unexpected event {} before message_start", e.name()),
        }
    }
    fn push(&mut self, event: Event) -> Result<()> {
        let event = Self::parse_event(event)?;
        if self.stopped { bail!("event after message stopped"); }

        match event {
            DeltaEvent::Ping => {},
            DeltaEvent::MessageStart{..} => bail!("duplicate message_start event"),
            DeltaEvent::ContentBlockStart { index, content_block } => {
                if self.blocks.insert(index, content_block).is_some() {
                    bail!("block {} started again", index);
                } else if self.completed_blocks.contains_key(&index) {
                    bail!("block {} started after completed", index);
                }
            },
            DeltaEvent::ContentBlockDelta { index, delta } => {
                if self.completed_blocks.contains_key(&index) {
                    bail!("block {} delta after completed", index);
                }
                let Some(block) = self.blocks.get_mut(&index) else {
                    bail!("block {} delta before start", index);
                };
                match (delta, block) {
                        // std string is not rope, cannot merge 2 owned string together without copy
                    (DeltaContentBlock::Text { text: text_delta },
                        RequestContentBlock::Text { text }) => text.push_str(&text_delta),
                    (DeltaContentBlock::Think { thinking: thinking_delta },
                        RequestContentBlock::Think{ thinking, .. }) => thinking.push_str(&thinking_delta),
                    (DeltaContentBlock::Signature { signature: signature_delta },
                        RequestContentBlock::Think{ signature, .. }) => signature.push_str(&signature_delta),
                    (DeltaContentBlock::ToolInput { partial_json },
                        RequestContentBlock::ToolUse{ input, .. }) => input.push_str(&partial_json),
                    (delta, block) => bail!("block delta type mismatch? {:?}, {:?}", delta, block),
                }
            },
            DeltaEvent::ContentBlockStop{ index } => {
                if let Some(block) = self.blocks.remove(&index) {
                    match block {
                        RequestContentBlock::Text{ text } if text.is_empty() =>
                            bail!("block {} stopped before any content? (3)", index),
                        RequestContentBlock::Think{ thinking, .. } if thinking.is_empty() =>
                            bail!("block {} stopped before any content? (1)", index),
                        RequestContentBlock::ToolUse{ input, .. } if input.is_empty() =>
                            bail!("block {} stopped before any content? (2)", index),
                        _ => {}, // ok
                    }
                    self.completed_blocks.insert(index, block);
                } else {
                    bail!("block {} stopped before started?", index);
                }
            },
            DeltaEvent::MessageDelta{ delta, usage } => {
                self.message.stop_reason = Some(delta.stop_reason);
                self.message.usage = usage;
            },
            DeltaEvent::MessageStop => {
                self.stopped = true;
                // don't forget to move blocks into message
                if !self.blocks.is_empty() {
                    bail!("some blocks not stopped when message stopped {:?}", self.blocks.keys());
                }
                if self.completed_blocks.is_empty() {
                    bail!("message stopped before any content blocks?");
                }
                // usize already restricted values >= 0, so compare max and len is enough for find holes
                // unwrap: validated is not empty
                let max_index = self.completed_blocks.keys().max().unwrap();
                if *max_index + 1 > self.completed_blocks.len() {
                    bail!("is it possible to have gaps in content block indexes?");
                }
                for index in 0..=*max_index {
                    // unwrap: validated index is continuous start from 0
                    self.message.content.push(self.completed_blocks.remove(&index).unwrap());
                }
            },
        }
        Ok(())
    }
}


#[tokio::main]
async fn main() -> Result<()> {

    let session_original_content = fs::read_to_string("example-input.yml")?;
    let session: Session = serde_yaml_ng::from_str(&session_original_content)?;
    println!("{:?}", session);
    validate_session(&session)?;
    // need to explicitly print session name or else the property is completely not used
    println!("session name {}", session.name);

    let request = prepare_request(&session)?;
    println!("request {:?}", request);

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    let client = reqwest::Client::builder().build()?;
    let request = client
        .post("https://api.deepseek.com/anthropic/v1/messages")
        .header("content-type", "application/json")
        .bearer_auth(api_key)
        .json(&request).build()?;
    let start_time = Utc::now();
    let response = client.execute(request).await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await?;
        bail!("response error {}: {}", status, body);
    }
    let mut headers = Vec::new();
    for (name, value) in response.headers() {
        headers.push((name.to_string(), format!("{:?}", value)));
        println!("header {}: {:?}", name, value);
    }

    let mut stream = response.bytes_stream();
    let mut parser = EventStreamParser::new();
    let mut assembler = None;
    let mut extra = Vec::new();

    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else { println!("failed to ? a chunk?"); continue };
        println!("{}", String::from_utf8_lossy(chunk.as_ref()));
        parser.push(chunk);
        while let Some(event) = parser.pull(&mut extra)? {
            // TODO is if let capturing lifetime too long?
            if assembler.is_none() {
                assembler = DeltaAssembler::try_new(event)?;
            } else {
                assembler.as_mut().map(|assembler| assembler.push(event));
            }
        }
    }

    let complete_time = Utc::now();
    let Some(assembler) = assembler else {
        bail!("assembler even not created?");
    };
    if !assembler.stopped {
        bail!("assembler not properly stopped");
    }
    println!("{:?}", assembler.message);
    let response_message = assembler.message;

    // unwrap: validated in prepare request
    let request_config = session.request_config.unwrap();
    let result_message = Message {
        id: request_config.message_id,
        parent_id: request_config.parent_message_id,
        role: Role::Assistant,
        request_config: Some(request_config.config),
        response_metadata: Some(ResponseMetadata {
            start_time,
            status_code: status.as_u16() as usize,
            headers,
            complete_time,
            model: response_message.model,
            // unwrap: stop reason is required in message_delta event
            stop_reason: response_message.stop_reason.unwrap(),
            usage: response_message.usage.to_string(),
            extra: Vec::new(), // TODO
        }),
        content: Content::Blocks(response_message.content.into_iter().map(|block| match block {
            RequestContentBlock::Text { text } => ContentBlock::Text{ name: None, value: text },
            RequestContentBlock::Think { thinking, signature } => ContentBlock::Think{ value: thinking, signature },
            RequestContentBlock::ToolUse { id, name, input } => ContentBlock::ToolUse{ id, name, input },
            RequestContentBlock::ToolResult {..} => unreachable!("tool-result?"),
        }).collect()),
    };

    let result_message = serialize_message(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    fs::write("example-output.yml", output_content)?;

    Ok(())
}

#[test]
fn test_read() {
    use std::assert_matches;

    let session = serde_yaml_ng::from_str(&vec![
        "name: session name",
        "create-time: 2026-10-22T07:59:01Z",
        "",
        "system:",
        "  content: You are a coding agent",
        "",
        "message-1:",
        "  role: user",
        "  content:",
        "    summary source code file src/main.rs",
        "",
        "message-3:",
        "  parent-id: 1",
        "  role: assistant",
        "  content:",
        "  - kind: think",
        "    value: reasoning content",
        "  - kind: text",
        "    value: normal content",
        "  - kind: tool-use",
        "    id: tool-call-id-1",
        "    name: read-file",
        "    # although you can inline json inside yaml line, there is no need to do that",
        "    input: '{ pathname: \"src/main.rs\" }'",
        "  - kind: tool-use",
        "    # even chat completion api support parallel tool calls if you didn't notice",
        "    id: tool-call-id-2",
        "    name: read-file",
        "    input: '{ pathname: \"src/session.rs\" }'",
        "  # store some of the response information in case they are useful",
        "  response:",
        "    create-time: TODO",
        "    status-code: 200",
        "    header-x-ds-trace-id: x-ds-trace-id1",
        "    header-date: Sun, 25 Oct 2026 08:47:50 GMT",
        "    header-eo-log-uuid: eo-log-uuid1",
        "    model: deepseek-flasher",
        "    complete-time: 2026-10-23T06:29:10Z",
        "    token-usage: 42/325/799",
        "",
        "message-4:",
        "  parent-id: 3",
        "  role: user",
        "  content:",
        "  - kind: text",
        "    name: additional-manual-description",
        "    value: additional manual description",
        "  - kind: tool-result",
        "    id: tool-call-id-1",
        "    value: |",
        "      use std::fs...",
        "      ...",
        "      struct Message...",
        "",
        "      fn read_session...",
        "      fn test_read...",
        "    metadata:",
        "      create-time: TODO",
        "      complete-time: etc.1",
        "      file-size: etc.2",
        "      return-size: etc.3",
        "      git-version: etc.4",
        "  - kind: tool-result",
        "    id: tool-call-id-2",
        "    value: |",
        "      use std::collections::{HashMap, BinaryHeap};...",
        "      ...",
        "",
        "request:",
        "  message-id: 5",
        "  parent-message-id: 4",
        "  model: deepseek-v4-pro",
        "  think: true",
        "  tools: [read-file]",
    ].join("\n")).expect("deserialization failed");
    println!("{:?}", session);
    validate_session(&session).expect("validation failed");

    assert_eq!(session.name, "session name");
    let Some(system_message) = &session.system_message else {
        panic!("session.system_message is none")
    };
    let Content::String(content) = &system_message.content else {
        panic!("session.system_message.content is not plain string")
    };
    assert_eq!(content, "You are a coding agent");
    assert_eq!(session.messages.len(), 3);
    assert_eq!(session.messages[0].id, 1);
    assert_eq!(session.messages[0].parent_id, 0);
    assert_matches!(session.messages[0].role, Role::User);
    assert!(session.messages[0].request_config.is_none());
    assert!(session.messages[0].response_metadata.is_none());
    let Content::String(content) = &session.messages[0].content else {
        panic!("session.messages[0].content is not plain string")
    };
    assert_eq!(content, "summary source code file src/main.rs");
    assert_eq!(session.messages[1].id, 3);
    assert_eq!(session.messages[1].parent_id, 1);
    assert_matches!(session.messages[1].role, Role::Assistant);
    let Content::Blocks(content_blocks) = &session.messages[1].content else {
        panic!("session.messages[1].content is not block array")
    };
    assert_eq!(content_blocks.len(), 4);
    assert_matches!(&content_blocks[0], ContentBlock::Think{ value, .. } if value == "reasoning content");
    assert_matches!(&content_blocks[1], ContentBlock::Text{ value, .. } if value == "normal content");
    let ContentBlock::ToolUse{ id, name, input } = &content_blocks[2] else {
        panic!("session.messages[1].content[2] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(name, "read-file");
    assert_eq!(input, "{ pathname: \"src/main.rs\" }");
    let ContentBlock::ToolUse{ id, name, input } = &content_blocks[3] else {
        panic!("session.messages[1].content[3] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(name, "read-file");
    assert_eq!(input, "{ pathname: \"src/session.rs\" }");
    // read don't read response metadata
    assert!(session.messages[1].request_config.is_none());
    assert!(session.messages[1].response_metadata.is_none());
    // assert_eq!(session.messages[2].response_metadata[0].0, "create-time");
    // assert_matches!(&session.messages[2].response_metadata[0].1, serde_yaml_ng::Value::String(value) if value == "TODO");
    
    assert_eq!(session.messages[2].id, 4);
    assert_eq!(session.messages[2].parent_id, 3);
    assert_matches!(session.messages[2].role, Role::User);
    let Content::Blocks(content_blocks) = &session.messages[2].content else {
        panic!("session.messages[2].content is not block array")
    };
    assert_eq!(content_blocks.len(), 3);
    assert_matches!(&content_blocks[0], ContentBlock::Text{ value, name }
        if name.as_deref() == Some("additional-manual-description") && value == "additional manual description");
    let ContentBlock::ToolResult{ id, value, metadata } = &content_blocks[1] else {
        panic!("session.messages[2].content[1] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(value, "use std::fs...\n...\nstruct Message...\n\nfn read_session...\nfn test_read...\n");
    assert_eq!(metadata.len(), 0);
    let ContentBlock::ToolResult{ id, value, metadata } = &content_blocks[2] else {
        panic!("session.messages[2].content[2] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(value, "use std::collections::{HashMap, BinaryHeap};...\n...\n");
    assert_eq!(metadata.len(), 0);

    let Some(request_config) = &session.request_config else {
        panic!("session.request_config not some");
    };
    assert_eq!(request_config.message_id, 5);
    assert_eq!(request_config.parent_message_id, 4);
    assert_eq!(request_config.config.model.as_deref(), Some("deepseek-v4-pro"));
    assert_matches!(request_config.config.think, ThinkingMode::Switch(true));
    assert_eq!(request_config.config.tool_names, vec!["read-file".to_string()]);
}

#[test]
fn test_write() {
    use chrono::TimeZone;

    assert_eq!(serialize_message(&Message {
        id: 3,
        parent_id: 2,
        role: Role::Assistant,
        content: Content::Blocks(vec![
            ContentBlock::Think{
                value: "why do you enable reasoning for this simple work?".to_string(),
                signature: "None".to_string(),
            },
            ContentBlock::Text{
                value: "let me read the files...".to_string(),
                name: None,
            },
            ContentBlock::ToolUse{
                id: "id1".to_string(),
                name: "read-file".to_string(),
                input: "{ pathname: \"src/main.rs\" }".to_string(),
            },
            ContentBlock::ToolUse{
                id: "id2".to_string(),
                name: "read-file".to_string(),
                input: "{ pathname: \"src/session.rs\" }".to_string(),
            },
        ]),
        request_config: Some(RequestConfig {
            model: None,
            think: ThinkingMode::Effort("high".to_string()),
            tool_names: vec!["tool1".to_string(), "tool2".to_string()],
            max_tokens: None,
        }),
        response_metadata: Some(ResponseMetadata{
            start_time: Utc.with_ymd_and_hms(2026, 10, 31, 12, 33, 0).unwrap(),
            complete_time: Utc.with_ymd_and_hms(2026, 10, 31, 12, 35, 0).unwrap(),
            status_code: 200,
            headers: vec![("x-ds-trace-id".to_string(), "x-ds-trace-id-1".to_string())],
            model: "deepseek-flasher".to_string(),
            stop_reason: "tool_use".to_string(),
            usage: r#"{"input_tokens":400,"cache_read_input_tokens":0,"output_tokens":40}"#.to_string(),
            extra: Vec::new(),
        }),
    }).expect("failed to serialize"), vec![
        "message-3:",
        "  parent-id: 2",
        "  role: assistant",
        // by the way, if you forgget the untagged, it will be content: !Blocks
        "  content:",
        "  - kind: think",
        "    value: why do you enable reasoning for this simple work?",
        "  - kind: text",
        "    value: let me read the files...",
        "  - kind: tool-use",
        "    id: id1",
        "    name: read-file",
        "    input: '{ pathname: \"src/main.rs\" }'",
        "  - kind: tool-use",
        "    id: id2",
        "    name: read-file",
        "    input: '{ pathname: \"src/session.rs\" }'",
        "  request:",
        "    think: high",
        "    tools:",
        "    - tool1",
        "    - tool2",
        "  response:",
        "    start-time: 2026-10-31T12:33:00Z",
        "    status-code: 200",
        "    header-x-ds-trace-id: x-ds-trace-id-1",
        "    complete-time: 2026-10-31T12:35:00Z",
        "    model: deepseek-flasher",
        "    stop-reason: tool_use",
        r#"    usage: '{"input_tokens":400,"cache_read_input_tokens":0,"output_tokens":40}'"#, "",
    ].join("\n"));

    assert_eq!(serialize_message(&Message {
        id: 5,
        parent_id: 42,
        role: Role::Assistant,
        content: Content::String("this file contains...\nand this file...".to_string()),
        request_config: None,
        response_metadata: None,
    }).expect("failed to serialize"), vec![
        "message-5:",
        "  parent-id: 42",
        "  role: assistant",
        // what's this |-
        "  content: |-",
        "    this file contains...",
        "    and this file...", "",
    ].join("\n"));
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

#[test]
fn test_assembler() {

    let mut parser = EventStreamParser::new();
    let mut assembler = None;
    let mut extra = Vec::new();

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
        while let Some(event) = parser.pull(&mut extra).expect("parser pull failed") {
            // TODO is if let capturing lifetime too long?
            if assembler.is_none() {
                assembler = DeltaAssembler::try_new(event).expect("try new error");
            } else {
                assembler.as_mut().map(|assembler| assembler.push(event));
            }
        }
    }
    let Some(assembler) = assembler else { panic!("not started") };
    assert!(assembler.stopped);
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
    });
}
