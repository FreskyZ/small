use std::collections::HashMap;
use std::fs;
use std::fmt;
use anyhow::{Result, bail};
use chrono::{Timelike as _, Utc};
use futures_util::StreamExt;
use serde::{Serialize, Serializer, Deserialize, Deserializer};
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess};
use serde::de::{Error as DeserializeError, Visitor as DeserializeVisitor};
use serde::ser::{SerializeMap as _, SerializeSeq as _};
use crate::sse::{EventStreamParser, ServerSentEvent};
use crate::handler::ALL_TOOLS;
use crate::session::{Role, Thinking, RequestConfig};
use crate::session::{ContentBlock, Message, Session, ResponseMetadata};

// specific api provider's request type, response type and sse handling, not include sse itself

// serialize same data structure to use in llm api
struct ContentBlockSerializeHelper<'a>(&'a ContentBlock);
impl<'a> Serialize for ContentBlockSerializeHelper<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(None)?;
        match self.0 {
            ContentBlock::Text{ name, value, .. } => {
                map.serialize_entry("type", "text")?;
                if let Some(name) = name {
                    map.serialize_entry("text", &format!("<{}>\n{}\n</{}>", name, value, name))?;
                } else {
                    map.serialize_entry("text", value)?;
                }
            },
            ContentBlock::Thinking{ value, signature } => {
                map.serialize_entry("type", "thinking")?;
                map.serialize_entry("thinking", value)?;
                map.serialize_entry("signature", signature)?;
            },
            ContentBlock::ToolUse{ id, name, input } => {
                map.serialize_entry("type", "tool_use")?;
                map.serialize_entry("id", id)?;
                map.serialize_entry("name", name)?;
                map.serialize_entry("input", input)?;
            },
            ContentBlock::ToolResult{ id, value, .. } => {
                map.serialize_entry("type", "tool_result")?;
                map.serialize_entry("tool_use_id", id)?;
                map.serialize_entry("content", value)?;
            },
        }
        map.end()
    }
}
// serialize same data structure to use in llm api
pub struct ContentSerializeHelper<'a>(pub &'a [ContentBlock]);
impl<'a> Serialize for ContentSerializeHelper<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for element in self.0 {
            if !matches!(element, ContentBlock::Text{ active: false, .. }) {
                seq.serialize_element(&ContentBlockSerializeHelper(element))?;
            }
        }
        seq.end()
    }
}

// serialize same data structure to use in llm api
pub struct MessageSerializeHelper<'a>(pub &'a Message);
impl<'a> Serialize for MessageSerializeHelper<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("role", &self.0.role)?;
        map.serialize_entry("content", &ContentSerializeHelper(&self.0.content))?;
        map.end()
    }
}

// you need add ?sized to struct to use that in impl
struct MinorSerializeHelper<'k, 'v, K: ?Sized, V: ?Sized>(&'k K, &'v V);

impl<'k, 'v, K, V> Serialize for MinorSerializeHelper<'k, 'v, K, V>
    where K: ?Sized + Serialize, V: ?Sized + Serialize
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(Some(1))?; map.serialize_entry(self.0, self.1)?; map.end()
    }
}

struct RequestBody<'a> {
    config: &'a RequestConfig,
    thread: Vec<&'a Message>,
}
impl<'a> Serialize for RequestBody<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("model", self.config.model.as_deref().unwrap_or("deepseek-flash"))?;
        // clippy say this *m can auto deref, but seeing
        // .map(|m| Helper(m)) you cannot change to .map(Helper), which is very confusing, so reject
        #[allow(clippy::explicit_auto_deref)]
        map.serialize_entry("messages", &self.thread.iter()
            .filter(|m| !m.role.is_system()).map(|m| MessageSerializeHelper(*m)).collect::<Vec<_>>())?;
        if let Some(system_message) = &self.thread.iter().find(|m| m.role.is_system()) {
            map.serialize_entry("system", &ContentSerializeHelper(&system_message.content))?;
        }
        if let Some(max_tokens) = self.config.max_tokens {
            map.serialize_entry("max_tokens", &max_tokens)?;
        }
        map.serialize_entry("stream", &true)?;
        match self.config.thinking {
            Thinking::Switch(true) => map.serialize_entry("thinking", &MinorSerializeHelper("type", "enabled"))?,
            Thinking::Switch(false) => map.serialize_entry("thinking", &MinorSerializeHelper("type", "disabled"))?,
            Thinking::Effort(effort) => map.serialize_entry("output_config", &MinorSerializeHelper("effort", effort))?,
        }
        let tools: Vec<_> = ALL_TOOLS.iter()
            .filter(|t| self.config.tool_names.iter().any(|n| n == t.name)).copied().collect();
        if !tools.is_empty() {
            map.serialize_entry("tools", &tools)?;
        }
        if self.config.title {
            map.serialize_entry("title", &MinorSerializeHelper("enabled", &true))?;
        }    
        map.end()
    }
}

struct MessageStart {
    id: String,
    model: String,
    // initial usage is not same as completing usage, record for fun
    usage: serde_json::Value,
    // even if you only do basic deserializing in this deserialize,
    // the caller is also a deserialize has similar context, so directly validate here is easier
    warnings: Vec<String>,
}
struct MessageStartDeserializeVisitor;

impl<'de> DeserializeVisitor<'de> for MessageStartDeserializeVisitor {
    type Value = MessageStart;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("message_start.message")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut id = None;
        let mut model = None;
        let mut usage = None;
        let mut warnings = Vec::new();
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                "id" => id = Some(map.next_value()?),
                "type" => {
                    let value = map.next_value::<&str>()?;
                    if value != "message" { warnings.push(format!("message-start.type != message?, {}", value)) }
                },
                "role" => {
                    let value = map.next_value::<&str>()?;
                    if value != "assistant" { warnings.push(format!("message-start.role != assistant? {}", value)) }
                },
                "model" => model = Some(map.next_value()?),
                "content" => {
                    let content = map.next_value::<serde_json::Value>()?;
                    if !matches!(&content, serde_json::Value::Array(array) if array.is_empty()) {
                        warnings.push(format!("message-start.content is not empty array? {:?}", content));
                    }
                },
                "stop_reason" | "stop_sequence" | "title" => {
                    let value = map.next_value::<serde_json::Value>()?;
                    if !matches!(value, serde_json::Value::Null) {
                        warnings.push(format!("message-start.{} is not null? {:?}", key, value));
                    }
                },
                "usage" => usage = Some(map.next_value()?),
                // you need to consume next value if not aborting deserializing process
                other => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("message-start: unknown property {}", other));
                },
            }
        }
        // according to original implementation, all these fields will always exist,
        // but no need to be too strict, they are all information only and not required
        let id = id.unwrap_or_else(|| "(none?)".to_string());
        let model = model.unwrap_or_else(|| "(none?)".to_string());
        let usage = usage.unwrap_or(serde_json::Value::Null);
        Ok(MessageStart{ id, model, usage, warnings })
    }
}
impl<'de> Deserialize<'de> for MessageStart {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(MessageStartDeserializeVisitor)
    }
}

// this is content-block-start event's content block if you ask
struct ContentBlockDeserializeVisitor;
impl<'de> DeserializeVisitor<'de> for ContentBlockDeserializeVisitor {
    // value and warnings, warnings should be for value (like unexpected empty) not for schema
    type Value = (ContentBlock, Vec<String>);
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("content block")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut kind: Option<&'static str> = None;
        let mut text = None;
        let mut thinking = None;
        let mut signature = None;
        let mut tool_use_id = None;
        let mut tool_use_name = None;
        let mut tool_use_input = None;
        let mut warnings = Vec::new();
        while let Some(key) = map.next_key::<&str>()? {
            match (kind, key) {
                (_, "type") => {
                    kind = match map.next_value::<&str>()? {
                        "text" => Some("text"),
                        "thinking" => Some("thinking"),
                        "tool_use" => Some("tool-use"),
                        other => return Err(DeserializeError::unknown_variant(other, &["text", "thinking", "tool_use"])),
                    };
                },
                // according to history data, major fields should be empty
                (Some("text"), "text") | (Some("thinking"), "thinking" | "signature") => {
                    let value = map.next_value::<String>()?;
                    if !value.is_empty() {
                        // record warning and continue
                        // existing content will be appended in delta event regardless of whether initial empty
                        warnings.push(format!("content-start: {} is not empty in start event? {}", key, value));
                    }
                    if key == "text" { text = Some(value); }
                    else if key == "thinking" { thinking = Some(value); }
                    else if key == "signature" { signature = Some(value); }
                },
                // tool use id and name are filled in start event, there is no place for them in delta and stop event
                (Some("tool-use"), "id" | "name") => {
                    let value = map.next_value::<String>()?;
                    if value.is_empty() {
                        // record warning and continue
                        // no name will make tool handling throw error, no id will make api throw error I guess
                        warnings.push(format!("content-start: {} is empty in start event?", key));
                    }
                    if key == "id" { tool_use_id = Some(value); } else { tool_use_name = Some(value); }
                },
                // except tool use input, it seems to be empty object in start event
                (Some("tool-use"), "input") => {
                    let value = map.next_value::<serde_json::Value>()?;
                    if !matches!(&value, serde_json::Value::Object(object) if object.is_empty()) {
                        // record warning and continue, existing content will be overwritten in stop events
                        warnings.push(format!("contente-start: input is not an empty object? {:?}", value));
                    }
                    tool_use_input = Some(value);
                },
                // you need to consume next value if the whole deserialize process is not aborted
                (_, other) => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("content-start: unknown property {}", other));
                },
            }
        }
        let Some(kind) = kind else { return Err(DeserializeError::missing_field("type")) };
        match kind {
            "text" => {
                let Some(value) = text else { return Err(DeserializeError::missing_field("text")) };
                Ok((ContentBlock::new_text(value), warnings))
            },
            "thinking" => {
                let Some(value) = thinking else { return Err(DeserializeError::missing_field("thinking")) };
                let Some(signature) = signature else { return Err(DeserializeError::missing_field("signature")) };
                Ok((ContentBlock::Thinking{ value, signature }, warnings))
            },
            "tool-use" => {
                let Some(id) = tool_use_id else { return Err(DeserializeError::missing_field("id")) };
                let Some(name) = tool_use_name else { return Err(DeserializeError::missing_field("name")) };
                let Some(input) = tool_use_input else { return Err(DeserializeError::missing_field("input")) };
                Ok((ContentBlock::ToolUse { id, name, input }, warnings))
            },
            _ => unreachable!("content-start deserialize impl kind"),
        }
    }
}
// use deserializeseed is one of the approaches to support type outside this crate (tuple is not defined in this crate)
struct ContentBlockDeserializeHelper;
impl<'de> DeserializeSeed<'de> for ContentBlockDeserializeHelper {
    type Value = (ContentBlock, Vec<String>);
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ContentBlockDeserializeVisitor)
    }
}

// although currently all of the variants are single string
// but in future it may be more complex for multimodal or server side tools, etc.
#[derive(Debug)]
enum ContentBlockDelta {
    Text{ text: String },
    Thinking{ thinking: String },
    Signature{ signature: String },
    ToolUse{ input: String },
}
struct ContentBlockDeltaDeserializeVisitor;
impl<'de> DeserializeVisitor<'de> for ContentBlockDeltaDeserializeVisitor {
    // value and warnings, warnings should be for value (like unexpected empty) not for schema
    type Value = (ContentBlockDelta, Vec<String>);
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("content block delta")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut kind = None;
        let mut value = None;
        let mut warnings = Vec::new();
        while let Some(key) = map.next_key::<&str>()? {
            match (kind, key) {
                (_, "type") => match map.next_value::<&str>()? {
                    "text_delta" => kind = Some("text"),
                    "thinking_delta" => kind = Some("thinking"),
                    "signature_delta" => kind = Some("signature"),
                    "input_json_delta" => kind = Some("input"),
                    other => return Err(DeserializeError::unknown_variant(other,
                        &["text_delta", "thinking_delta", "signature_delta", "input_json_delta"])),
                },
                | (Some("text"), "text")
                | (Some("thinking"), "thinking")
                | (Some("signature"), "signature")
                | (Some("input"), "partial_json") => {
                    let text = map.next_value::<String>()?;
                    if text.is_empty() {
                        warnings.push(format!("content-delta: {} is empty?", key));
                    }
                    value = Some(text);
                },
                (_, other) => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("content-delta: unknown property {}", other));
                },
            }
        }
        let Some(kind) = kind else { return Err(DeserializeError::missing_field("type")) };
        match kind {
            "text" => Ok((ContentBlockDelta::Text{
                text: value.ok_or_else(|| DeserializeError::missing_field("text"))?,
            }, warnings)),
            "thinking" => Ok((ContentBlockDelta::Thinking{
                thinking: value.ok_or_else(|| DeserializeError::missing_field("thinking"))?,
            }, warnings)),
            "signature" => Ok((ContentBlockDelta::Signature {
                signature: value.ok_or_else(|| DeserializeError::missing_field("signature"))?,
            }, warnings)),
            "input" => Ok((ContentBlockDelta::ToolUse{
                input: value.ok_or_else(|| DeserializeError::missing_field("partial_json"))?,
            }, warnings)),
            _ => unreachable!("content-delta deserialize impl kind"),
        }
    }
}
struct ContentBlockDeltaDeserializeSeed;
impl<'de> DeserializeSeed<'de> for ContentBlockDeltaDeserializeSeed {
    type Value = (ContentBlockDelta, Vec<String>);
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ContentBlockDeltaDeserializeVisitor)
    }
}

struct MessageDelta {
    stop_reason: String,
    title: Option<String>,
    warnings: Vec<String>,
}
struct MessageDeltaDeserializeVisitor;
impl<'de> DeserializeVisitor<'de> for MessageDeltaDeserializeVisitor {
    type Value = MessageDelta;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("message delta delta")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut stop_reason = None;
        let mut title = None;
        let mut warnings = Vec::new();
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                // according to history data, stop reason is always available, but no need to be too strict
                "stop_reason" => stop_reason = Some(map.next_value()?),
                // stop sequence is not used
                "stop_sequence" => { map.next_value::<IgnoredAny>()?; },
                "title" => title = Some(map.next_value()?),
                other => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("message-delta: unknown property {}", other));
                },
            }
        }
        let stop_reason = stop_reason.unwrap_or_else(|| "(none?)".to_string());
        Ok(MessageDelta{ stop_reason, title, warnings })
    }
}
impl<'de> Deserialize<'de> for MessageDelta {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(MessageDeltaDeserializeVisitor)
    }
}

// this is not exactly same as the schema in streaming response,
// but validated and normalized format to use in response builder
enum ResponseDelta {
    // although ignored in response builder,
    // need to return something Ok to let response builder skip
    Ping,
    // usage is valid json object, it is not used later so directly convert to string here
    // initial usage is not same as completing usage, record for fun
    MessageStart{ id: String, model: String, usage: serde_json::Value },
    ContentStart{ index: usize, block: ContentBlock },
    ContentDelta{ index: usize, delta: ContentBlockDelta },
    ContentStop{ index: usize },
    // response schema is valid json object, it is not used later so directly convert to string here
    MessageDelta{ stop_reason: String, title: Option<String>, usage: serde_json::Value },
    MessageStop,
}
// now that top level deserialize cannot use deserializeseed, you have to newtype a tuple
struct ResponseDeltaW(ResponseDelta, Vec<String>);

struct ResponseDeltaDeserializeVisitor;

impl<'de> DeserializeVisitor<'de> for ResponseDeltaDeserializeVisitor {
    type Value = ResponseDeltaW;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("partial response")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut kind = None;
        let mut message_start = None;
        let mut content_index = None;
        let mut content_start = None;
        let mut content_delta = None;
        let mut message_delta = None;
        let mut usage = None;
        let mut all_warnings = Vec::new();
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                "type" => match map.next_value::<&str>()? {
                    "ping" => kind = Some("ping"),
                    "message_start" => kind = Some("message-start"),
                    "content_block_start" => kind = Some("content-start"),
                    "content_block_delta" => kind = Some("content-delta"),
                    "content_block_stop" => kind = Some("content-stop"),
                    "message_delta" => kind = Some("message-delta"),
                    "message_stop" => kind = Some("message-stop"),
                    other => return Err(DeserializeError::unknown_variant(other, &["ping", "message_start",
                        "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"])),
                }
                "message" if kind == Some("message-start") => {
                    let mut value = map.next_value::<MessageStart>()?;
                    all_warnings.extend(std::mem::take(&mut value.warnings));
                    message_start = Some(value);
                },
                "index" if matches!(kind, Some("content-start" | "content-delta" | "content-stop")) => {
                    content_index = Some(map.next_value()?);
                },
                "content_block" if kind == Some("content-start") => {
                    let (value, warnings) = map.next_value_seed(ContentBlockDeserializeHelper)?;
                    all_warnings.extend(warnings);
                    content_start = Some(value);
                },
                "delta" if kind == Some("content-delta") => {
                    let (value, warnings) = map.next_value_seed(ContentBlockDeltaDeserializeSeed)?;
                    all_warnings.extend(warnings);
                    content_delta = Some(value);
                },
                // why do you split properties into .usage and .delta?
                "usage" if kind == Some("message-delta") => {
                    usage = Some(map.next_value()?);
                },
                "delta" if kind == Some("message-delta") => {
                    let mut value = map.next_value::<MessageDelta>()?;
                    all_warnings.extend(std::mem::take(&mut value.warnings));
                    message_delta = Some(value);
                },
                other => {
                    map.next_value::<IgnoredAny>()?;
                    all_warnings.push(format!("response-delta: unknown property {}", other));
                },
            }
        }
        let Some(kind) = kind else { return Err(DeserializeError::missing_field("type")); };
        match kind {
            "ping" => Ok(ResponseDeltaW(ResponseDelta::Ping, all_warnings)),
            "message-start" => {
                let Some(start) = message_start else { return Err(DeserializeError::missing_field("message")); };
                Ok(ResponseDeltaW(ResponseDelta::MessageStart{
                    id: start.id,
                    model: start.model,
                    usage: start.usage,
                }, all_warnings))
            },
            "content-start" => {
                let Some(index) = content_index else { return Err(DeserializeError::missing_field("index")); };
                let Some(block) = content_start else { return Err(DeserializeError::missing_field("content_block")); };
                Ok(ResponseDeltaW(ResponseDelta::ContentStart{ index, block }, all_warnings))
            },
            "content-delta" => {
                let Some(index) = content_index else { return Err(DeserializeError::missing_field("index")); };
                let Some(delta) = content_delta else { return Err(DeserializeError::missing_field("delta")); };
                Ok(ResponseDeltaW(ResponseDelta::ContentDelta{ index, delta }, all_warnings))
            },
            "content-stop" => {
                let Some(index) = content_index else { return Err(DeserializeError::missing_field("index")); };
                Ok(ResponseDeltaW(ResponseDelta::ContentStop{ index }, all_warnings))
            },
            "message-delta" => {
                let usage = usage.unwrap_or(serde_json::Value::Null);
                let Some(delta) = message_delta else { return Err(DeserializeError::missing_field("delta")); };
                Ok(ResponseDeltaW(ResponseDelta::MessageDelta{
                    usage,
                    title: delta.title,
                    stop_reason: delta.stop_reason,
                }, all_warnings))
            },
            "message-stop" => Ok(ResponseDeltaW(ResponseDelta::MessageStop, all_warnings)),
            _ => unreachable!("response delta impl deserialize kind"),
        }
    }
}
impl<'de> Deserialize<'de> for ResponseDeltaW {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ResponseDeltaDeserializeVisitor)
    }
}

struct ResponseData {
    message_id: String,
    model: String,
    title: Option<String>,
    content: Vec<ContentBlock>,
    stop_reason: String,
    usage: (serde_json::Value, serde_json::Value),
}
// integrator: sum of delta is integration
struct ResponseIntegrator {
    data: ResponseData,
    started: bool, // message started
    stopped: bool, // message stopped
    // started and not completed blocks
    active_blocks: HashMap<usize, ContentBlock>,
    // content-block.tool-use.input is json value, but delta event only has
    // stringified segments, so need a separate string builder to store them
    json_builders: HashMap<usize, String>,
    // completed blocks, not sure whether will receive blocks by index,
    // so completed blocks still need map and validate index gap after complete
    completed_blocks: HashMap<usize, ContentBlock>,
    // try collect unexpected conditions and continue handling to end of the stream
    warnings: Vec<String>,
}
impl ResponseIntegrator {

    fn new() -> Self {
        Self {
            started: false,
            stopped: false,
            active_blocks: HashMap::new(),
            json_builders: HashMap::new(),
            completed_blocks: HashMap::new(),
            warnings: Vec::new(),
            // new with default value is easier to use than a mutable Option
            data: ResponseData {
                message_id: String::new(),
                model: String::new(),
                title: None,
                content: Vec::new(),
                stop_reason: String::new(),
                usage: (serde_json::Value::Null, serde_json::Value::Null),
            },
        }
    }

    // no expected error, all collected and try continue
    // you may think this continuous push pattern can reverse into taking an iterator
    // but an async iterator cannot become a plain iterator, so currently this is good for avoid async
    fn push(&mut self, event: ServerSentEvent) {
        // use event.data as message header, it is generally short and distinguishable
        macro_rules! raise { ($($arg:tt)*) => {{ self.warnings.push(format!($($arg)*)); }} }

        let Ok(ResponseDeltaW(delta, warnings)) = serde_json::from_str(&event.data)
            .map_err(|e| raise!("{}: deserialize error: {}", event.data, e)) else { return; };
        self.warnings.extend(warnings);
        
        let delta_kind = match delta {
            ResponseDelta::Ping => "ping",
            ResponseDelta::MessageStart{..} => "message_start",
            ResponseDelta::ContentStart{..} => "content_block_start",
            ResponseDelta::ContentDelta{..} => "content_block_delta",
            ResponseDelta::ContentStop{..} => "content_block_stop",
            ResponseDelta::MessageDelta{..} => "message_delta",
            ResponseDelta::MessageStop => "message_stop",
        };
        if let Some(event_name) = event.name && event_name != delta_kind {
            raise!("{}: name and data.type mismatch, {} != {}", event.data, event_name, delta_kind);
        }
        // return: no need to action after message stopped
        if self.stopped { raise!("{}: unexpected event after message stopped", event.data); return; }

        match delta {
            // ping is allowed anywhere
            ResponseDelta::Ping => {},
            // normal first event
            ResponseDelta::MessageStart{ id, model, usage } if !self.started => {
                self.started = true;
                self.data.message_id = id;
                self.data.model = model;
                self.data.usage.0 = usage;
            },
            ResponseDelta::MessageStart{..} /* if started */ =>
                raise!("{}: duplicate message_start event", event.data),
            // use this to reject all other events before started
            // no need to return, you can still operate content blocks regardless of message started?
            _ if !self.started =>
                raise!("{}: unexpected event {} before message_start", event.data, delta_kind),
            ResponseDelta::ContentStart { index, block } => {
                println!("\nblock_start {} {:?}", index, block);
                // check completed first, should not insert if is in completed list while not in active list
                if self.completed_blocks.contains_key(&index) {
                    raise!("{}: block {} started after completed", event.data, index);
                } else if self.active_blocks.insert(index, block).is_some() {
                    raise!("{}: block {} started again", event.data, index);
                }
            },
            ResponseDelta::ContentDelta{ index, delta } => {
                if self.completed_blocks.contains_key(&index) {
                    raise!("{}: block {} delta after completed", event.data, index);
                }
                let Some(block) = self.active_blocks.get_mut(&index) else {
                    // return: cannot continue if cannot find target block to manipulate
                    raise!("{}: block {} delta before start", event.data, index); return;
                };
                match (delta, block) {
                    // std string is not rope, cannot merge 2 owned string together without copy
                    (ContentBlockDelta::Text{ text }, ContentBlock::Text { value, .. }) => {
                        print!("{}", text); value.push_str(&text);
                    },
                    (ContentBlockDelta::Thinking{ thinking }, ContentBlock::Thinking{ value, .. }) => {
                        print!("{}", thinking); value.push_str(&thinking);
                    },
                    (ContentBlockDelta::Signature{ signature: signature_delta }, ContentBlock::Thinking{ signature, .. }) => {
                        print!("{}", signature_delta); signature.push_str(&signature_delta);
                    },
                    (ContentBlockDelta::ToolUse{ input }, ContentBlock::ToolUse{..}) => {
                        print!("{}", input); self.json_builders.entry(index).or_default().push_str(&input);
                    },
                    (delta, block) => raise!("{}: block delta type mismatch? {:?}, {:?}", event.data, delta, block),
                }
            },
            ResponseDelta::ContentStop{ index } => {
                println!("\nblock_stop {}", index);
                let Some(mut block) = self.active_blocks.remove(&index) else {
                    // return: cannot continue if cannot find target block to manipulate
                    raise!("{}: block {} stopped before started?", event.data, index); return;
                };
                match &mut block {
                    ContentBlock::Text{ value, .. } if value.is_empty() =>
                        raise!("{}: text block {} stopped before any content?", event.data, index),
                    ContentBlock::Thinking{ value, .. } if value.is_empty() =>
                        raise!("{}: thinking block {} stopped before any thinking?", event.data, index),
                    ContentBlock::ToolUse{ input, .. } => if let Some(builder) = self.json_builders.remove(&index) {
                        match serde_json::from_str(&builder) {
                            Ok(v) => *input = v,
                            Err(e) => raise!("{}: tool use block {} failed to parse json: {}", event.data, index, e),
                        }
                    } else {
                        raise!("{}: tool use block {} stopped before any json", event.data, index);
                    },
                    _ => {}, // ok if they are not empty
                }
                self.completed_blocks.insert(index, block);
            },
            ResponseDelta::MessageDelta{ stop_reason, usage, title } => {
                self.data.stop_reason = stop_reason;
                self.data.usage.1 = usage;
                self.data.title = title;
            },
            ResponseDelta::MessageStop => {
                self.stopped = true;
                // don't forget to move blocks into message
                if !self.active_blocks.is_empty() {
                    raise!("message_stop: some blocks not stopped when message stopped {:?}", self.active_blocks.keys());
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
                    self.data.content.push(self.completed_blocks.remove(&index).unwrap());
                }
            },
        }
    }

    fn end(&mut self) {
        if !self.started {
            self.warnings.push("end: not started when stream end?".to_string());
        }
        if !self.stopped {
            self.warnings.push("end: not stopped when stream end?".to_string());
        }
    }
}

pub struct RequestParameters<'a> {
    pub dry: bool,
    pub api_key: String,
    pub session: &'a Session,
    pub config: RequestConfig,
}
pub async fn run(parameters: RequestParameters<'_>) -> Result<Message> {

    let mut thread = Vec::new();
    let mut next_parent_id = Some(parameters.config.message_id);
    while let Some(parent_id) = next_parent_id {
        // unwrap: validated parent id exist
        let parent_message = parameters.session.messages.iter().find(|m| m.id == parent_id).unwrap();
        thread.push(parent_message);
        next_parent_id = parent_message.parent_id;
    }
    /* reverse is here */ thread.reverse(); /* reverse is here */
    // already validated parent role relationship, request message id is user,
    // message without parent id is user and no loop in parent relationship, no need to validate more

    // validate tool names
    let unknown_tool_names = parameters.config.tool_names.iter()
        .map(|n| n.as_str())
        .filter(|n| !ALL_TOOLS.iter().any(|e| &e.name == n)).collect::<Vec<_>>();
    if !unknown_tool_names.is_empty() {
        bail!("unknown tool names {}", unknown_tool_names.join(","));
    }

    let request_body = RequestBody { config: &parameters.config, thread };
    fs::write("request.json", &serde_json::to_string_pretty(&request_body)?)?;
    
    let base_url = parameters.config.base_url.as_deref().unwrap_or("https://api.deepseek.com/anthropic");
    let mut url = reqwest::Url::parse(base_url)?;
    let path_name = std::path::PathBuf::from(url.path()).join("v1/messages");
    let path_name = path_name.to_str().ok_or_else(|| anyhow::anyhow!("failed to create request url?"))?;
    url.set_path(path_name);

    if parameters.dry { bail!("this is dry run, use --not-dry to actually run"); }

    let client = reqwest::Client::builder().build()?;
    let request = client
        .post(url.clone())
        .header("content-type", "application/json")
        .bearer_auth(parameters.api_key)
        .json(&request_body).build()?;
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
    // https://www.rfc-editor.org/info/rfc9110/#name-content-type, https://www.rfc-editor.org/info/rfc2046/
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
    let mut integrator = ResponseIntegrator::new();

    let mut raw_chunks = Vec::new();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else { println!("failed to ? a chunk?"); continue };
        raw_chunks.push(String::from_utf8_lossy(chunk.as_ref()).into_owned());
        parser.push(chunk);
        while let Some(event) = parser.pull()? {
            integrator.push(event);
        }
    }
    integrator.end();

    // unwrap: provided nanosecond is valid
    let complete_time = Utc::now().with_nanosecond(0).unwrap();
    if !integrator.warnings.is_empty() {
        integrator.warnings.iter().for_each(|e| eprintln!("{}", e));
    }
    let response_log = raw_chunks.into_iter().chain(integrator.warnings).collect::<Vec<_>>().join("\n");
    if let Err(error) = fs::write("response.log", &response_log) {
        eprintln!("failed to write response.log: {}", error);
        eprintln!("{}", response_log);
    }

    let response_data = integrator.data;
    // unwrap: session.messages is not empty
    let result_message_id = parameters.session.messages.iter().map(|m| m.id).max().unwrap() + 1;

    let complete_usage = serde_json::to_string(&response_data.usage.1)?;
    let mut additional = Vec::new();
    additional.push(("start-usage".to_string(), serde_json::Value::String(serde_json::to_string(&response_data.usage.0)?)));
    if let Some(title) = response_data.title {
        additional.push(("title".to_string(), serde_json::Value::String(title)));
    }

    Ok(Message {
        id: result_message_id,
        parent_id: Some(parameters.config.message_id),
        role: Role::Assistant,
        content: response_data.content,
        request_config: Some(parameters.config),
        response_metadata: Some(ResponseMetadata {
            start_time,
            status_code: status.as_u16() as usize,
            headers: noticeable_headers,
            complete_time,
            model: response_data.model,
            provider_message_id: response_data.message_id,
            stop_reason: response_data.stop_reason,
            usage: complete_usage,
            additional,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;

    #[test]
    fn test_build_response() {

        let mut parser = EventStreamParser::new();
        let mut builder = ResponseIntegrator::new();

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
                builder.push(event);
            }
        }
        builder.end();
        assert!(builder.started);
        assert!(builder.stopped);
        assert_eq!(builder.warnings, Vec::<String>::new());
        assert_eq!(builder.data.message_id, "e6ef6a63-a078-4f53-a73b-38c8d1d46310");
        assert_eq!(builder.data.model, "deepseek-flash");
        // json parse and serialize make properties reorder TODO change to compare json
        assert_eq!(builder.data.usage.0, serde_json::json!({"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}));
        assert_eq!(builder.data.content.len(), 1);
        let ContentBlock::Text{ value, name, active } = &builder.data.content[0] else {
            panic!("content[0] is not text");
        };
        assert!(name.is_none());
        assert_eq!(value, "Hello!");
        assert!(active);
        assert_eq!(builder.data.stop_reason, "end_turn");
        assert_eq!(builder.data.usage.1, serde_json::json!({"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}));
        assert!(builder.data.title.is_none());
    }

    #[test]
    fn test_build_response_2() {

        let mut parser = EventStreamParser::new();
        let mut builder = ResponseIntegrator::new();

        for chunk in [br#"event: message_start
data: {"type":"message_start","message":{"id":"bdc3","type":"message","role":"assistant","model":"deepseek-flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":13516,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Now"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" I"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" have"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" ("}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" scal"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"ars"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":","}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" all"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"],"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" including"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" `"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"l"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-empty"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"(n"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" nb"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" c"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-by"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"te"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-order"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-mark"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"`"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" ("}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" `"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"c"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"print"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" `"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"s"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":").\n"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"`"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" ="}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"ES"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" spaces"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" (`"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"s"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":").\n\n"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"So"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" \u2014"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" on"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"\"?"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"actly"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":";"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"om"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-l"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"\\"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"nt"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" than"}}

event: content_block_delta
data: {"type":"conte"# as &[u8], br#"nt_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" n"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":")."}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":")"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delt"#, br#"a":{"type":"thinking_delta","thinking":" =>"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" detected"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"literal"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"#, br###""delta":{"type":"thinking_delta","thinking":"\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" has"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"-white"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"515"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"203"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"."}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"bdc3"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"##"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":" Answer"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"pace"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"(n"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"extra"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"**"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":")."}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"call_00","name":"list-directory","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"max"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"-items"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":": "}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"200"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":", \""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"path"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":": \""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"docs"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: content_block_start
data: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"call_01","name":"list-directory","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"path"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":": \""}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"scripts"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":3}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":13516,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":4617,"service_tier":"standard","output_tokens_details":{"thinking_tokens":3467}}}

event: message_stop
data: {"type":"message_stop"}

"###].map(|c| Bytes::from_static(c)) {
            parser.push(chunk);
            while let Some(event) = parser.pull().expect("parser pull failed") {
                builder.push(event);
            }
        }
        builder.end();
        assert!(builder.started);
        assert!(builder.stopped);
        assert_eq!(builder.warnings, Vec::<String>::new());
        assert_eq!(builder.data.message_id, "bdc3");
        assert_eq!(builder.data.model, "deepseek-flash");
        assert_eq!(builder.data.usage.0,
            serde_json::json!({"input_tokens":13516,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}));
        assert_eq!(builder.data.content.len(), 4);
        let ContentBlock::Thinking{ value, signature } = &builder.data.content[0] else {
            panic!("content[0] is not text");
        };
        assert_eq!(value, "Now I have ( scalars, all], including `l-empty(n nb- c-byte-order-mark` ( `c-print `s).\n` =ES spaces (`s).\n\nSo — on\"?actly;om-l\\nt than n).) => detectedliteral\" has-white515203.");
        // oh good, signature is same as message id
        assert_eq!(signature, "bdc3");
        let ContentBlock::Text{ value, name, active } = &builder.data.content[1] else {
            panic!("content[1] is not text");
        };
        assert!(name.is_none());
        assert_eq!(value, "## Answerpace(nextra**).");
        assert!(active);
        let ContentBlock::ToolUse{ id, name, input } = &builder.data.content[2] else {
            panic!("content[2] is not tool-use");
        };
        assert_eq!(id, "call_00");
        assert_eq!(name, "list-directory");
        assert_eq!(input, &serde_json::json!({"max-items":200,"path":"docs"}));
        let ContentBlock::ToolUse{ id, name, input } = &builder.data.content[3] else {
            panic!("content[3] is not tool-use");
        };
        assert_eq!(id, "call_01");
        assert_eq!(name, "list-directory");
        assert_eq!(input, &serde_json::json!({"path":"scripts"}));
        assert_eq!(builder.data.stop_reason, "end_turn");
        assert_eq!(builder.data.usage.1,
            serde_json::json!({"input_tokens":13516,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":4617,"service_tier":"standard","output_tokens_details":{"thinking_tokens":3467}}));
        assert!(builder.data.title.is_none());

    }
}
