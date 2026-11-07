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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
enum Role {
    #[serde(rename = "user")]
    User,
    #[serde(rename = "assistant")]
    Assistant,
}
impl Role {
    fn is_user(&self) -> bool { matches!(self, Role::User) }
    fn is_assistant(&self) -> bool { matches!(self, Role::Assistant) }
    fn display(&self) -> &'static str { match self { Self::User => "user", Self::Assistant => "assistant" } }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum ContentBlock {
    Text{
        // use this to wrap text chunks in xml tag: <name>value</name>
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        value: String,
    },
    // - use think as tag because it is shorter than thinking and reasoning
    // - if you have learned that thinking content don't need to be sent in message history in
    //   following conversation rounds, it is different in tool call scenario, it is required
    //   for tool use turns to let the model "continue thinking", this also implies all requests
    //   in same tool use turn should use same thinking switch, all enabled or all disabled,
    //   thinking effort is not restricted, you can use low effort for minor requests
    // - signature is required for a/ messages api to validate thinking content is not changed
    //   or made up, it is currently not required for deepseek compatible api, but always save
    //   and send the signature back is simpler and easier to understand
    Think{
        value: String,
        signature: String,
    },
    ToolUse{ 
        id: String,
        name: String,
        // - the value types in serde_json and serde_yaml_anything are just flexible objects,
        //   it's ok to serialize and deserialize between serde_json value type and yaml text
        // - use custom serialize and deserialize functions to inline this in a string
        #[serde(serialize_with = "serialize_with_json", deserialize_with = "deserialize_with_json")]
        input: serde_json::Value,
    },
    ToolResult{
        id: String,
        value: String,
        // - tool execution metadata, logs, etc.
        // - the value types in serde_json and serde_yaml_anything are just flexible objects,
        //   it's ok to serialize and deserialize between serde_json value type and yaml text
        // - custom deserialize function is the correct way to skip deserializing while allow
        //   the name with deny_unknown_fields
        #[serde(default, deserialize_with = "skip_deserializing_while_allow_name")]
        metadata: Vec<(String, serde_json::Value)>,
    },
}

fn serialize_with_json<S>(value: &serde_json::Value, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
    let serialized = serde_json::to_string(value).map_err(|e| serde::ser::Error::custom(format!("{}", e)))?;
    serializer.serialize_str(&serialized)
}
fn deserialize_with_json<'de, D>(deserializer: D) -> Result<serde_json::Value, D::Error> where D: Deserializer<'de> {
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = serde_json::Value;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("json value")
        }
        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> where E: DeserializeError {
            Ok(serde_json::from_str(v).map_err(|e| DeserializeError
                ::invalid_value(serde::de::Unexpected::Str(&format!("{}", e)), &"valid json value"))?)
        }
    }
    deserializer.deserialize_any(Visitor)
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

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Content {
    String(String),
    Blocks(Vec<ContentBlock>),
}
// untagged's error message is not clear if anything not match content block structure,
// use custom deserialize implementation to aovid that while keep the setting to avoid tags appear in serializing result
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
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
impl ThinkingMode {
    fn is_default(&self) -> bool {
        matches!(self, Self::Switch(false))
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct RequestConfig {
    // need deserialize from persistant file, need skip when serialize into result message
    #[serde(skip_serializing)]
    message_id: usize,
    #[serde(skip_serializing)]
    // parent message id is required in request config if you didn't notice
    parent_message_id: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    // default to disabled
    #[serde(default, skip_serializing_if = "ThinkingMode::is_default")]
    think: ThinkingMode,
    // why do Option fields allowed to missing with skip_serializing_if, vec don't?
    #[serde(rename = "tools", default, skip_serializing_if = "Vec::is_empty")]
    tool_names: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<usize>,
    // - traditional parameters, temperature, top_p, top_k, presence_penalty and frequency_penalty
    //   don't work with thinking mode, actually they are not that useful or respected in nowadays
    //   models even without thinking mode, so not include them here
    // - non traditional parameter tool_choice don't work with thinking mode either, so not include
}

#[derive(Debug)]
struct ResponseMetadata {
    start_time: DateTime<Utc>,
    status_code: usize,
    // include some not constant header values in case they are useful
    headers: Vec<(String, String)>,
    // response stream complete time
    complete_time: DateTime<Utc>,
    // result model
    model: String,
    stop_reason: String,
    // save json text here, currently no need to parse them precisely, actually
    // you can use postgresql's rich json functionality to query values if need
    usage: String,
    // additional information if useful
    // serde_json::Value can be serialized into yaml text if you ask
    additional: Vec<(String, serde_json::Value)>,
}
// flatten header+extra, note that serde flatten don't support ordered map types like vec<(string, string)>
impl Serialize for ResponseMetadata {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(
            Some(6 + self.headers.len() + self.additional.len()))?;
        map.serialize_entry("start-time", &self.start_time)?;
        map.serialize_entry("status-code", &self.status_code)?;
        for (key, value) in &self.headers {
            map.serialize_entry(&format!("header-{}", key), value)?;
        }
        map.serialize_entry("complete-time", &self.complete_time)?;
        map.serialize_entry("model", &self.model)?;
        map.serialize_entry("stop-reason", &self.stop_reason)?;
        map.serialize_entry("usage", &self.usage)?;
        for (key, value) in &self.additional {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

// system message don't have all other properties in user and assitant messages
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SystemMessage {
    content: Content,
}

// now that id, pid and role is not in message itself serializing and deserializing,
// request config and response metadata need rename and is not in deserializing but
// need special handling to allow the name, etc., so the result is fully manual
#[derive(Debug)]
struct Message {
    id: usize,
    parent_id: Option<usize>,
    role: Role,
    content: Content,
    // only in assistant message, the request config to create this message
    request_config: Option<RequestConfig>,
    // only in assistant message, the response metadata of the response to create this message
    response_metadata: Option<ResponseMetadata>,
}

// this serialize a document that include message key and value
impl Serialize for Message {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        // you have lifetime errors for simple single usize value ??
        // let parent_id = if let Some(v) = self.parent_id { format_args!("<-{}", v) } else { format_args("") };
        let parent_id = if let Some(v) = self.parent_id { format!("<-{}", v) } else { String::new() };
        let key = format!("{}[{}{}]", self.role.display(), self.id, parent_id);
        
        // custom serialize does not directly support nested map, that mean you need this
        struct MessageBody<'a>(&'a Message);
        impl<'a> Serialize for MessageBody<'a> {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
                let size = 1
                    + if self.0.request_config.is_some() { 1 } else { 0 }
                    + if self.0.response_metadata.is_some() { 1 } else { 0 };
                let mut map = serializer.serialize_map(Some(size))?;
                map.serialize_entry("content", &self.0.content)?;
                if let Some(request_config) = &self.0.request_config {
                    map.serialize_entry("request", request_config)?;
                }
                if let Some(response_metadata) = &self.0.response_metadata {
                    map.serialize_entry("response", response_metadata)?;
                }
                map.end()
            }
        }
        let mut map = serializer.serialize_map(Some(1))?;
        map.serialize_entry(&key, &MessageBody(self))?;
        map.end()
    }
}
// this only deserialize message body, currently only the content,
// and allow request config and response metadata but does not actually read them
impl<'de> Deserialize<'de> for Message {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Message;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("message content")
            }
            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
                let mut content = None;
                while let Some(key) = map.next_key::<&str>()? {
                    match key {
                        "content" => content = Some(map.next_value()?),
                        "request" => { map.next_value::<IgnoredAny>()?; },
                        "response" => { map.next_value::<IgnoredAny>()?; },
                        other => return Err(DeserializeError::unknown_field(other, &["content", "request", "response"])),
                    }
                }
                let Some(content) = content else { return Err(DeserializeError::missing_field("content")); };
                Ok(Message{ id: 0, parent_id: None, role: Role::Assistant, content, request_config: None, response_metadata: None })
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

// this is not deserialize to handle special message id naming convention
#[derive(Debug)]
struct Session {
    name: String,
    system_message: Option<SystemMessage>,
    // this is a flattened array of message tree structure, items reference parent node by id and parent id
    messages: Vec<Message>,
    request_config: Option<RequestConfig>,
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
                        key if key.ends_with(']')
                            && let Some(remain) = key.strip_prefix("user[").or_else(|| key.strip_prefix("assistant[")) =>
                        {
                            // trim end ], unwrap: validated endswith
                            let remain = &remain[..remain.len() - 1];
                            let mut split = remain.split("<-");
                            // unwrap: split must have at least 1 element
                            let id = split.next().unwrap().parse().map_err(|_| DeserializeError
                                ::invalid_value(serde::de::Unexpected::Str(remain), &"positive integer"))?;
                            if id <= 0 { return Err(DeserializeError
                                ::invalid_value(serde::de::Unexpected::Str(remain), &"positive value")); }
                            let parent_id = split.next().map(|parent_id| {
                                let parent_id = parent_id.parse::<usize>().map_err(|_| DeserializeError
                                    ::invalid_value(serde::de::Unexpected::Str(remain), &"positive integer"))?;
                                if parent_id <= 0 { return Err(DeserializeError
                                    ::invalid_value(serde::de::Unexpected::Str(remain), &"positive value")); }
                                Ok(parent_id)
                            }).transpose()?;
                            let mut message = map.next_value::<Message>()?;
                            message.id = id;
                            message.parent_id = parent_id;
                            message.role = if key.starts_with("user") { Role::User } else { Role::Assistant };
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

struct TextDisplay<'a>(&'a str);
// display major text chunks by limit length, add ellipsis and replace \n with \n
impl<'a> fmt::Display for TextDisplay<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        // don't directly [..80], that will cut inside code points
        let leading: String = self.0.chars().take(80).collect();
        if leading.len() == self.0.len() {
            write!(f, "{}", leading.replace('\n', "\\n"))
        } else {
            write!(f, "{}...({} bytes)", leading.replace('\n', "\\n"), self.0.len())
        }
    }
}

fn get_session_display(session: &Session) -> Result<String> {
    let mut b = String::new();

    fn write_content(b: &mut String, content: &Content) -> Result<()> {
        match content {
            Content::String(value) =>
                writeln!(b, "   {}", TextDisplay(value))?,
            Content::Blocks(blocks) => for block in blocks {
                match block {
                    ContentBlock::Text{ name: Some(name), value } =>
                        writeln!(b, "   <{}>\n   {}", name, TextDisplay(value))?,
                    ContentBlock::Text{ value, .. } =>
                        writeln!(b, "   {}", TextDisplay(value))?,
                    ContentBlock::Think{ value, .. } =>
                        writeln!(b, "   <think>\n   {}", TextDisplay(value))?,
                    ContentBlock::ToolUse{ id, name, input } =>
                        writeln!(b, "   <tool-use>\n   {}({})[{}]", name, input, id)?,
                    ContentBlock::ToolResult{ id, value, .. } =>
                        writeln!(b, "   <tool-result>\n   {}\n   {}", id, TextDisplay(value))?,
                }
            }
        }
        Ok(())
    }

    writeln!(b, "session:\n{}", session.name)?;
    if let Some(system_message) = &session.system_message {
        writeln!(b, "system:")?;
        write_content(&mut b, &system_message.content)?;
    }
    for message in &session.messages {
        writeln!(b, "{} [{}<-{}]:", message.role.display(), message.id, message.parent_id.unwrap_or(0))?;
        write_content(&mut b, &message.content)?;
    }
    if let Some(request_config) = &session.request_config {
        writeln!(b, "request config [{}<-{}]:", request_config.message_id, request_config.parent_message_id)?;
        if let Some(base_url) = &request_config.base_url { writeln!(b, "   base url: {}", base_url)?; }
        if let Some(model) = &request_config.model { writeln!(b, "   model: {}", model)?; }
        if !matches!(request_config.think, ThinkingMode::Switch(false)) { writeln!(b, "   think mode: {:?}", request_config.think)?; }
        if request_config.tool_names.is_empty().not() { writeln!(b, "   tool names: [{}]", request_config.tool_names.join(","))?; }
        if let Some(max_tokens) = request_config.max_tokens { writeln!(b, "   max tokens: {}", max_tokens)?; }
    }

    Ok(b)
}

// return expected errors
fn validate_session(session: &Session) -> Result<Vec<String>> {

    // x. missing property or primitive type mismatch is rejected by basic deserializing
    // x. multiple system message is rejected by yaml parse
    // 1. system message don't have other content block type
    // x. multiple request config is rejected by yaml parse
    // 2. duplicate message id, include request config
    // 2. parent id exist, include request config
    // 3. user message don't have think and tool use blocks
    // 4. assistant message don't have tool result blocks
    // 6. same thinking switch in tool call turns

    let mut errors = Vec::new();
    macro_rules! raise { ($($arg:tt)*) => {{ errors.push(format!($($arg)*)); }} }

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
    let mut remaining_tool_use_ids = Vec::new();
    let mut current_tool_turn_thinking = false;
    for message in &session.messages {
        if !message_ids.insert(message.id) {
            raise!("message-{}: duplicate message id", message.id);
        }
        // this correctly handles pid is Some or None
        if Some(message.id) == message.parent_id {
            raise!("message-{}: parent id cannot be same as id", message.id);
        } else if let Some(parent_id) = message.parent_id {
            if let Some(parent_message) = session.messages.iter().find(|m| m.id == parent_id) {
                if !matches!((&message.role, &parent_message.role), (Role::User,  Role::Assistant) | (Role::Assistant, Role::User)) {
                    raise!("message-{}: unexpected parent message role relationship", message.id);
                }
            } else {
                raise!("message-{}: parent-id {} not exist", message.id, parent_id);
            }
        }
        if let Content::Blocks(blocks) = &message.content {
            for (block_index, block) in blocks.iter().enumerate() {
                match block {
                    ContentBlock::Text{ name, .. } if message.role.is_assistant() && name.is_some() =>
                        raise!("message-{}: content#{}: unknown field name, expect kind, value for assistant message", message.id, block_index),
                    ContentBlock::Think{..} if message.role.is_user() => 
                        raise!("message-{}: content#{}: kind: unknown variant think, expect text, tool-result for user message", message.id, block_index),
                    ContentBlock::ToolUse{..} if message.role.is_user() => {
                        raise!("message-{}: content#{}: kind: unknown variant think, expect text, tool-result for user message", message.id, block_index);
                    }
                    ContentBlock::ToolUse{ id, ..} => {
                        // regard empty as start new tool use turn
                        if remaining_tool_use_ids.is_empty() {
                            current_tool_turn_thinking = blocks.iter().any(|b| matches!(b, ContentBlock::Think{..}));
                        }
                        remaining_tool_use_ids.push(id);
                    }
                    ContentBlock::ToolResult{..} if message.role.is_assistant() =>
                        raise!("message-{}: content#{}: kind: unknown variant tool-result, expect text, think, tool-use for assistant message", message.id, block_index),
                    ContentBlock::ToolResult{ id: result_id, ..} => {
                        if let Some(position) = remaining_tool_use_ids.iter().position(|v| v == &result_id) {
                            remaining_tool_use_ids.remove(position);
                            // history tool-result message's thinking mode is not recorded, so this can only validate request-config.parent-message-id
                            if let Some(RequestConfig{ parent_message_id, think, .. }) = &session.request_config {
                                if parent_message_id == &message.id && current_tool_turn_thinking != !matches!(think, ThinkingMode::Switch(false)) {
                                    raise!("message-{}: content#{}: thinking switch is different from tool use turn, expect {}", message.id, block_index, current_tool_turn_thinking);
                                }
                            }
                        } else {
                            raise!("message-{}: content#{}: tool result id not found in remaining id", message.id, block_index);
                        }
                        if let Some(parent_message) = session.messages.iter().find(|m| Some(m.id) == message.parent_id) {
                            if let Content::Blocks(blocks) = &parent_message.content {
                                if !blocks.iter().any(|p| matches!(p, ContentBlock::ToolUse{ id: use_id, .. } if use_id == result_id)) {
                                    raise!("message-{}: content#{}: expect tool result id find in parent message's tool use blocks", message.id, block_index);
                                }
                            } else {
                                raise!("message-{}: content#{}: expect tool result id find in parent message's tool use blocks (1)", message.id, block_index);
                            }
                        } else {
                            raise!("message-{}: content#{}: expect parent-id exist when there is tool-result block", message.id, block_index);
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

        if let Some(base_url) = &request_config.base_url {
            if let Err(error) = reqwest::Url::parse(base_url) {
                raise!("request config: base url parse error: {}", error);
            }
        }
        if let Some(model) = &request_config.model {
            if !matches!(model.as_str(), "deepseek-flash" | "deepseek-v4-pro") {
                raise!("request config: unknown model name, expect deepseek-flash and deepseek-v4-pro");
            }
        }
        if let ThinkingMode::Effort(effort) = &request_config.think {
            if !matches!(effort.as_str(), "low" | "high" | "max") {
                raise!("request config: unknown thinking mode, expect true/false/low/high/max");
            }
        }
        if let Some(max_tokens) = request_config.max_tokens {
            if max_tokens <= 0 {
                raise!("invalid max-tokens, expect positive value");
            }
        }
    }

    Ok(errors)
}

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
    effort: String,
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
}

fn prepare_request(session: &Session) -> Result<Request> {

    let Some(request_config) = &session.request_config else { bail!("missing request config") };

    let mut thread = Vec::new();
    let mut next_parent_id = Some(request_config.parent_message_id);
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

    let model = request_config.model.as_deref().unwrap_or("deepseek-flash").to_string();
    let (thinking, output_config) = match &request_config.think {
        ThinkingMode::Switch(true) => (Some(RequestThinking{ r#type: "enabled".to_string() }), None),
        ThinkingMode::Switch(false) => (Some(RequestThinking{ r#type: "disabled".to_string() }), None),
        ThinkingMode::Effort(effort) => (None, Some(RequestOutputConfig{ effort: effort.clone() })),
    };
    let max_tokens = request_config.max_tokens;

    let system = session.system_message.as_ref().map(|m| match &m.content {
        Content::String(value) => vec![RequestContentBlock::Text{ text: value.clone() }],
        Content::Blocks(blocks) => blocks.iter().map(|b| match b {
            ContentBlock::Text{ name: None, value } => 
                RequestContentBlock::Text{ text: value.clone() },
            ContentBlock::Text{ name: Some(name), value } => 
                RequestContentBlock::Text{ text: format!("<{}>{}</{}>", name, value, name) },
            _ => unreachable!("system message content block type"),
        }).collect(),
    });
    let messages = thread.into_iter().map(|message| RequestMessage{
        role: message.role,
        content: match &message.content {
            Content::String(value) => vec![RequestContentBlock::Text{ text: value.clone() }],
            Content::Blocks(blocks) => blocks.iter().map(|b| match b {
                // NOTE these .trim() should be consistent or else cache will invalidate
                ContentBlock::Text{ name: None, value } => 
                    RequestContentBlock::Text{ text: value.trim_ascii().to_string() },
                ContentBlock::Text{ name: Some(name), value } => 
                    RequestContentBlock::Text{ text: format!("<{}>{}</{}>", name, value.trim_ascii().to_string(), name) },
                ContentBlock::Think{ value, signature } =>
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
        },
    }).collect();

    // currently deepseek api validate tool name duplicate, don't rely on that
    let tools = vec![
        ToolDefinition{
            name: "read-file",
            description: "Read the contents of a file.",
            // now this part have to use json!
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path of the file to read.",
                    },
                },
                "required": ["path"],
            }),
        },
        ToolDefinition{
            name: "list-directory",
            description: concat!("List file system entries in directory."),
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
    ].into_iter().filter(|t| request_config.tool_names.iter().any(|n| n == t.name)).collect();

    Ok(Request { model, system, messages, thinking, output_config, max_tokens, stream: true, tools })
}

fn get_request_display(request: &Request) -> Result<String> {
    let mut b = String::new();

    fn write_content(b: &mut String, blocks: &[RequestContentBlock]) -> Result<()> {
        for block in blocks {
            match block {
                RequestContentBlock::Text{ text } =>
                    writeln!(b, "   {}", TextDisplay(text))?,
                RequestContentBlock::Think{ thinking, signature } =>
                    writeln!(b, "   <think>\n   {}\n   {}", signature, TextDisplay(thinking))?,
                RequestContentBlock::ToolUse{ id, name, input, .. } =>
                    writeln!(b, "   <tool-use>\n   {}({})[{}]", name, input, id)?,
                RequestContentBlock::ToolResult{ tool_use_id, content, .. } =>
                    writeln!(b, "   <tool-result>\n   {}\n   {}", tool_use_id, TextDisplay(content))?,
            }
        }
        Ok(())
    }

    writeln!(b, "request:")?;
    writeln!(b, "model: {}", request.model)?;
    writeln!(b, "thining: {:?}", request.thinking)?;
    writeln!(b, "output config: {:?}", request.output_config)?;
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
            DeltaEvent::MessageDelta{ delta, usage } => {
                self.message.stop_reason = Some(delta.stop_reason);
                self.message.usage = usage;
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
#[command(name = "huan")]
#[command(about = "huan cli")]
struct Command {
    #[arg(long)]
    not_dry: bool,
    filename: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let command = Command::parse();
    println!("file name {}", command.filename);

    let session_original_content = fs::read_to_string(&command.filename)?;
    let session: Session = serde_yaml_ng::from_str(&session_original_content)?;
    println!("{}", get_session_display(&session)?);
    let errors = validate_session(&session)?;
    if errors.is_empty().not() {
        errors.iter().for_each(|e| eprintln!("{}", e));
        bail!("has validation errors, abort");
    }

    let request = prepare_request(&session)?;
    println!("{}", get_request_display(&request)?);
    if !command.not_dry { println!("this is dry run, use --not-dry to actually run"); return Ok(()); }
    // return Ok(());

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    let client = reqwest::Client::builder().build()?;
    let request = client
        .post("https://api.deepseek.com/anthropic/v1/messages")
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
    let additional = Vec::new();

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
    // unwrap: validated in prepare request
    let request_config = session.request_config.unwrap();
    let result_message = Message {
        id: request_config.message_id,
        parent_id: Some(request_config.parent_message_id),
        role: Role::Assistant,
        request_config: Some(request_config),
        response_metadata: Some(ResponseMetadata {
            start_time,
            status_code: status.as_u16() as usize,
            headers: noticeable_headers,
            complete_time,
            model: response_message.model,
            // unwrap: stop reason is required in message_delta event
            stop_reason: response_message.stop_reason.unwrap(),
            usage: response_message.usage.to_string(),
            additional,
        }),
        content: Content::Blocks(response_message.content.into_iter().map(|block| match block {
            RequestContentBlock::Text { text } => ContentBlock::Text{ name: None, value: text },
            RequestContentBlock::Think { thinking, signature } => ContentBlock::Think{ value: thinking, signature },
            RequestContentBlock::ToolUse { id, name, input, .. } => ContentBlock::ToolUse{ id, name, input },
            RequestContentBlock::ToolResult {..} => unreachable!("tool-result?"),
        }).collect()),
    };

    let result_message = serde_yaml_ng::to_string(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    println!("write {}", command.filename);
    fs::write(&command.filename, output_content)?;

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
        "user[1]:",
        "  content:",
        "    summary source code file src/main.rs",
        "",
        "assistant[3<-1]:",
        "  content:",
        "  - kind: think",
        "    value: reasoning content",
        "    signature: signature content",
        "  - kind: text",
        "    value: normal content",
        "  - kind: tool-use",
        "    id: tool-call-id-1",
        "    name: read-file",
        "    # although you can inline json inside yaml line, there is no need to do that",
        "    input: '{ \"pathname\": \"src/main.rs\" }'",
        "  - kind: tool-use",
        "    # even chat completion api support parallel tool calls if you didn't notice",
        "    id: tool-call-id-2",
        "    name: read-file",
        "    input: '{ \"pathname\": \"src/session.rs\" }'",
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
        "user[4<-3]:",
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
    assert_eq!(session.messages[0].parent_id, None);
    assert_matches!(session.messages[0].role, Role::User);
    assert!(session.messages[0].request_config.is_none());
    assert!(session.messages[0].response_metadata.is_none());
    let Content::String(content) = &session.messages[0].content else {
        panic!("session.messages[0].content is not plain string")
    };
    assert_eq!(content, "summary source code file src/main.rs");
    assert_eq!(session.messages[1].id, 3);
    assert_eq!(session.messages[1].parent_id, Some(1));
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
    assert_eq!(input, &serde_json::json!({ "pathname": "src/main.rs" }));
    let ContentBlock::ToolUse{ id, name, input } = &content_blocks[3] else {
        panic!("session.messages[1].content[3] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(name, "read-file");
    assert_eq!(input, &serde_json::json!({ "pathname": "src/session.rs" }));
    // read don't read response metadata
    assert!(session.messages[1].request_config.is_none());
    assert!(session.messages[1].response_metadata.is_none());
    // assert_eq!(session.messages[2].response_metadata[0].0, "create-time");
    // assert_matches!(&session.messages[2].response_metadata[0].1, serde_yaml_ng::Value::String(value) if value == "TODO");
    
    assert_eq!(session.messages[2].id, 4);
    assert_eq!(session.messages[2].parent_id, Some(3));
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
    assert_eq!(request_config.model.as_deref(), Some("deepseek-v4-pro"));
    assert_matches!(request_config.think, ThinkingMode::Switch(true));
    assert_eq!(request_config.tool_names, vec!["read-file".to_string()]);
}

#[test]
fn test_write() {
    use chrono::TimeZone;

    assert_eq!(serde_yaml_ng::to_string(&Message {
        id: 3,
        parent_id: Some(2),
        role: Role::Assistant,
        content: Content::Blocks(vec![
            ContentBlock::Think{
                value: "why do you enable reasoning for this simple work?".to_string(),
                signature: "12345678-1234-1234-123456".to_string(),
            },
            ContentBlock::Text{
                value: "let me read the files...".to_string(),
                name: None,
            },
            ContentBlock::ToolUse{
                id: "id1".to_string(),
                name: "read-file".to_string(),
                input: serde_json::json!({ "pathname": "src/main.rs" }),
            },
            ContentBlock::ToolUse{
                id: "id2".to_string(),
                name: "read-file".to_string(),
                input: serde_json::json!({ "pathname": "src/session.rs" }),
            },
        ]),
        request_config: Some(RequestConfig {
            message_id: 0,
            parent_message_id: 0,
            base_url: None,
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
            additional: Vec::new(),
        }),
    }).expect("failed to serialize"), vec![
        "assistant[3<-2]:",
        // by the way, if you forgget the untagged, it will be content: !Blocks
        "  content:",
        "  - kind: think",
        "    value: why do you enable reasoning for this simple work?",
        "    signature: 12345678-1234-1234-123456",
        "  - kind: text",
        "    value: let me read the files...",
        "  - kind: tool-use",
        "    id: id1",
        "    name: read-file",
        "    input: '{\"pathname\":\"src/main.rs\"}'",
        "  - kind: tool-use",
        "    id: id2",
        "    name: read-file",
        "    input: '{\"pathname\":\"src/session.rs\"}'",
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

    assert_eq!(serde_yaml_ng::to_string(&Message {
        id: 5,
        parent_id: Some(42),
        role: Role::Assistant,
        content: Content::String("this file contains...\nand this file...".to_string()),
        request_config: None,
        response_metadata: None,
    }).expect("failed to serialize"), vec![
        "assistant[5<-42]:",
        // what's this |-
        "  content: |-",
        "    this file contains...",
        "    and this file...", "",
    ].join("\n"));
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
    });

    // TODO signature delta is one delta event
}
