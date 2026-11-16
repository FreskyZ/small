use std::collections::HashMap;
use std::fs;
use std::fmt;
use anyhow::{Result, bail};
use chrono::{Timelike as _, Utc};
use futures_util::StreamExt;
use serde::{Serialize, Serializer, Deserialize, Deserializer};
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess};
use serde::de::{Visitor as DeserializeVisitor};
use serde::ser::{SerializeMap as _, SerializeSeq as _};
use crate::sse::{EventStreamParser, ServerSentEvent};
use crate::handler::ALL_TOOLS;
use crate::session::{Role, SystemMessage, Thinking};
use crate::session::{ContentBlock, Message, RequestConfig, Session, ResponseMetadata};

// specific api provider's request type, response type and sse handling, not include sse itself

// serialize same data structure to use in llm api
struct ContentBlockSerializeHelper<'a>(&'a ContentBlock);
impl<'a> Serialize for ContentBlockSerializeHelper<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(None)?;
        match self.0 {
            ContentBlock::Text{ name, value } => {
                map.serialize_entry("type", "text")?;
                if let Some(name) = name {
                    map.serialize_entry("text", &format!("<{}>{}</{}>", name, value, name))?;
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
            seq.serialize_element(&ContentBlockSerializeHelper(element))?;
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

// messages and request config can directly serialize without help of minor serializable
// objects and complex customization to redirect to message/content custom serializations
struct RequestSerializeHelper<'a> {
    config: &'a RequestConfig,
    system: Option<&'a SystemMessage>,
    thread: Vec<&'a Message>,
}
impl<'a> Serialize for RequestSerializeHelper<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("model", self.config.model.as_deref().unwrap_or("deepseek-flash"))?;
        map.serialize_entry("messages", &self.thread.iter().map(|m| MessageSerializeHelper(*m)).collect::<Vec<_>>())?;
        if let Some(system_message) = &self.system {
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
            .filter(|t| self.config.tool_names.iter().any(|n| n == t.name)).map(|t| *t).collect();
        if !tools.is_empty() {
            map.serialize_entry("tools", &tools)?;
        }
        if self.config.title {
            map.serialize_entry("title", &MinorSerializeHelper("enabled", &true))?;
        }    
        map.end()
    }
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
                "usage" => {
                    let value = map.next_value::<serde_json::Value>()?;
                    // TODO update
                    let _ = serde_json::to_string(&value).map(|v| usage = Some(v)).map_err(|e| warnings.push(format!(
                        "message-start.usage: what do you mean by json to string error? {}, {:?}", e, value)));
                },
                // you need to consume next value if the whole deserialize process is not aborted
                other => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("message-start: unknown property {}", other));
                },
            }
        }
        Ok(MessageStart{ id, model, usage, warnings })
    }
}
struct MessageStart {
    // according to original implementation, all these fields will always exist,
    // but no need to be too strict, all these fields are information only and not required
    id: Option<String>,
    model: Option<String>,
    // initial usage is not same as completing usage, record for fun
    usage: Option<String>,
    // even if you only do basic deserializing in this deserialize,
    // the caller is also a deserialize has similar context, so directly validate here is easier
    warnings: Vec<String>,
}
impl<'de> Deserialize<'de> for MessageStart {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(MessageStartDeserializeVisitor)
    }
}

struct ContentBlockDeserializeVisitor;
impl<'de> DeserializeVisitor<'de> for ContentBlockDeserializeVisitor {
    // return None for cannot give a reasonable value, like missing kind
    type Value = (Option<ContentBlock>, Vec<String>);
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
            match (key, kind) {
                ("type", _) => {
                    kind = match map.next_value::<&str>()? {
                        "text" => Some("text"),
                        "thinking" => Some("thinking"),
                        "tool_use" => Some("tool-use"),
                        // decide to warning here because content block type may be extended in future
                        other => {
                            warnings.push(format!("content-start.type: unknown variant, {}", other));
                            return Ok((None, warnings));
                        },
                    };
                },
                // according to history data, major fields are generally empty
                ("text", Some("text")) | ("thinking" | "signature", Some("thinking")) => {
                    let value = map.next_value::<String>()?;
                    if !value.is_empty() {
                        warnings.push(format!("content-start: {} is not empty in start event? {}", key, value));
                    }
                    if key == "text" { text = Some(value); }
                    else if key == "thinking" { thinking = Some(value); }
                    else if key == "signature" { signature = Some(value); }
                },
                // except id and name, they are filled in start event, there is no place for them in delta and stop event
                ("id" | "name", Some("tool-use")) => {
                    let value = map.next_value::<String>()?;
                    if value.is_empty() {
                        warnings.push(format!("content-start: {} is empty in start event?", key));
                    }
                    if key == "id" { tool_use_id = Some(value); } else { tool_use_name = Some(value); }
                },
                // except tool use input, it seems to be empty object in start event
                ("input", Some("tool-use")) => {
                    let value = map.next_value::<serde_json::Value>()?;
                    if !matches!(&value, serde_json::Value::Object(object) if object.is_empty()) {
                        warnings.push(format!("contente-start: input is not an empty object? {:?}", value));
                    }
                    tool_use_input = Some(value);
                },
                // you need to consume next value if the whole deserialize process is not aborted
                (other, _) => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("content-start: unknown property {}", other));
                },
            }
        }
        let Some(kind) = kind else {
            warnings.push("content-start: missing kind".to_string()); return Ok((None, warnings));
        };
        match kind {
            "text" => {
                let value = text.unwrap_or_else(||
                    { warnings.push("content-start: missing text?".to_string()); String::new() });
                Ok((Some(ContentBlock::Text{ name: None, value }), warnings))
            },
            "thinking" => {
                let value = thinking.unwrap_or_else(||
                    { warnings.push("content-start: missing thinking?".to_string()); String::new() });
                let signature = signature.unwrap_or_else(||
                    { warnings.push("content-start: missing signature?".to_string()); String::new() });
                Ok((Some(ContentBlock::Thinking{ value, signature }), warnings))
            },
            "tool-use" => {
                let id = tool_use_id.unwrap_or_else(||
                    { warnings.push("content-start: missing tool use id?".to_string()); String::new() });
                let name = tool_use_name.unwrap_or_else(||
                    { warnings.push("content-start: missing tool use name?".to_string()); String::new() });
                let input = tool_use_input.unwrap_or_else(||
                    { warnings.push("content-start: missing tool use input?".to_string()); serde_json::Value::Null });
                Ok((Some(ContentBlock::ToolUse { id, name, input }), warnings))
            },
            _ => unreachable!("content-start deserialize impl's kind"),
        }
    }
}

struct ContentBlockDeserializeHelper;
impl<'de> DeserializeSeed<'de> for ContentBlockDeserializeHelper {
    type Value = (Option<ContentBlock>, Vec<String>);
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ContentBlockDeserializeVisitor)
    }
}

struct ContentBlockDeltaDeserializeVisitor;
impl<'de> DeserializeVisitor<'de> for ContentBlockDeltaDeserializeVisitor {
    type Value = (Option<ContentBlockDelta>, Vec<String>);
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("content block delta")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut kind = None;
        let mut text = None;
        let mut warnings = Vec::new();
        while let Some(key) = map.next_key::<&str>()? {
            match (key, kind) {
                ("type", _) => match map.next_value::<&str>()? {
                    "text_delta" => kind = Some("text"),
                    "thinking_delta" => kind = Some("thinking"),
                    "signature_delta" => kind = Some("signature"),
                    "input_json_delta" => kind = Some("input"),
                    // decide to warning here because content block type may be extended in future
                    other => {
                        warnings.push(format!("content-delta.type: unknown variant, {}", other));
                        return Ok((None, warnings));
                    },
                },
                | ("text", Some("text"))
                | ("thinking", Some("thinking"))
                | ("signature", Some("signature"))
                | ("partial_json", Some("input")) => {
                    let value = map.next_value::<String>()?;
                    if value.is_empty() {
                        warnings.push(format!("content-delta: {} is empty?", key));
                    }
                    text = Some(value);
                },
                (other, _) => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("content-delta: unknown property {}", other));
                },
            }
        }
        let Some(kind) = kind else {
            warnings.push("content-delta: missing kind".to_string()); return Ok((None, warnings));
        };
        let Some(text) = text else {
            warnings.push("content-delta: missing text".to_string()); return Ok((None, warnings));
        };
        match kind {
            "text" => Ok((Some(ContentBlockDelta::Text{ text }), warnings)),
            "thinking" => Ok((Some(ContentBlockDelta::Thinking{ thinking: text }), warnings)),
            "signature" => Ok((Some(ContentBlockDelta::Signature { signature: text }), warnings)),
            "input" => Ok((Some(ContentBlockDelta::ToolUse{ input: text }), warnings)),
            _ => unreachable!("content-delta impl deserialize kind"),
        }
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
struct ContentBlockDeltaDeserializeSeed;
impl<'de> DeserializeSeed<'de> for ContentBlockDeltaDeserializeSeed {
    type Value = (Option<ContentBlockDelta>, Vec<String>);
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ContentBlockDeltaDeserializeVisitor)
    }
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
        Ok(MessageDelta{ stop_reason, title, warnings })
    }
}

struct MessageDelta {
    stop_reason: Option<String>,
    title: Option<String>,
    warnings: Vec<String>,
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
    MessageStart{ id: String, model: String, usage: String },
    ContentStart{ index: usize, block: ContentBlock },
    ContentDelta{ index: usize, delta: ContentBlockDelta },
    ContentStop{ index: usize },
    // response schema is valid json object, it is not used later so directly convert to string here
    MessageDelta{ stop_reason: String, title: Option<String>, usage: String },
    MessageStop,
}

struct ResponseDeltaDeserializeVisitor;

impl<'de> DeserializeVisitor<'de> for ResponseDeltaDeserializeVisitor {
    type Value = ResponseDeltaAnd;
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
        let mut warnings = Vec::new();
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
                    other => {
                        // you can continue next sse event by skip this even-kind-is-unkown
                        // event, but this function have to end because nothing more can be done
                        warnings.push(format!("type: unknown variant {}?", other)); return Ok(ResponseDeltaAnd(None, warnings));
                    },
                }
                "message" if kind == Some("message-start") => {
                    let mut value = map.next_value::<MessageStart>()?;
                    warnings.extend(std::mem::take(&mut value.warnings));
                    message_start = Some(value);
                },
                "index" if matches!(kind, Some("content-start" | "content-delta" | "content-stop")) => {
                    content_index = Some(map.next_value()?);
                },
                "content_block" if kind == Some("content-start") => {
                    let (value, new_warnings) = map.next_value_seed(ContentBlockDeserializeHelper)?;
                    warnings.extend(new_warnings);
                    content_start = value;
                },
                "delta" if kind == Some("content-delta") => {
                    let (value, new_warnings) = map.next_value_seed(ContentBlockDeltaDeserializeSeed)?;
                    warnings.extend(new_warnings);
                    content_delta = value;
                },
                // why do you split properties into .usage and .delta?
                "usage" if kind == Some("message-delta") => {
                    let value = map.next_value::<serde_json::Value>()?;
                    // TODO update
                    let _ = serde_json::to_string(&value).map(|v| usage = Some(v)).map_err(|e| warnings.push(format!(
                        "message-delta.usage: what do you mean by json to string error? {}, {:?}", e, value)));
                },
                "delta" if kind == Some("message-delta") => {
                    let mut value = map.next_value::<MessageDelta>()?;
                    warnings.extend(std::mem::take(&mut value.warnings));
                    message_delta = Some(value);
                },
                other => {
                    map.next_value::<IgnoredAny>()?;
                    warnings.push(format!("unknown property {}", other));
                },
            }
        }
        let Some(kind) = kind else {
            warnings.push("missing kind".to_string()); return Ok(ResponseDeltaAnd(None, warnings)); };
        match kind {
            "ping" => Ok(ResponseDeltaAnd(Some(ResponseDelta::Ping), warnings)),
            "message-start" => if let Some(message_start) = message_start {
                Ok(ResponseDeltaAnd(Some(ResponseDelta::MessageStart{
                    id: message_start.id.unwrap_or("(none?)".to_string()),
                    model: message_start.model.unwrap_or("(none?)".to_string()),
                    usage: message_start.usage.unwrap_or("(none?)".to_string()),
                }), warnings))
            } else {
                warnings.push("message-start: missing message?".to_string());
                let none = "(none?)".to_string();
                // NOTE event should be consistant with kind, or else it result in cascading errors in event order
                Ok(ResponseDeltaAnd(Some(ResponseDelta::MessageStart{
                    id: none.clone(), model: none.clone(), usage: none }), warnings))
            },
            "content-start" => {
                let Some(index) = content_index else {
                    warnings.push("content-start: missing index".to_string());
                    // but not for missing index, provides placeholder value result in cascading errors in event order
                    return Ok(ResponseDeltaAnd(Some(ResponseDelta::Ping), warnings));
                };
                if let Some(block) = content_start {
                    Ok(ResponseDeltaAnd(Some(ResponseDelta::ContentStart{ index, block }), warnings))
                } else {
                    warnings.push("content-start: missing content block?".to_string());
                    let block = ContentBlock::Text{ name: None, value: String::new() };
                    Ok(ResponseDeltaAnd(Some(ResponseDelta::ContentStart{ index, block }), warnings))
                }
            },
            "content-delta" => {
                let Some(index) = content_index else {
                    warnings.push("content-delta: missing index".to_string());
                    return Ok(ResponseDeltaAnd(Some(ResponseDelta::Ping), warnings));
                };
                if let Some(delta) = content_delta {
                    Ok(ResponseDeltaAnd(Some(ResponseDelta::ContentDelta{ index, delta }), warnings))
                } else {
                    warnings.push("content-delta: missing content delta?".to_string());
                    let delta = ContentBlockDelta::Text{ text: String::new() };
                    Ok(ResponseDeltaAnd(Some(ResponseDelta::ContentDelta{ index, delta }), warnings))
                }
            },
            "content-stop" => {
                let Some(index) = content_index else {
                    warnings.push("content-stop: missing index".to_string());
                    return Ok(ResponseDeltaAnd(Some(ResponseDelta::Ping), warnings));
                };
                Ok(ResponseDeltaAnd(Some(ResponseDelta::ContentStop{ index }), warnings))
            },
            "message-delta" => {
                let usage = usage.unwrap_or_else(||
                    { warnings.push("message-delta: missing usage".to_string()); "(none?)".to_string() });
                if let Some(message_delta) = message_delta {
                    Ok(ResponseDeltaAnd(Some(ResponseDelta::MessageDelta{
                        usage,
                        title: message_delta.title,
                        stop_reason: message_delta.stop_reason.unwrap_or("(none?)".to_string()),
                    }), warnings))
                } else {
                    warnings.push("message-delta: missing delta?".to_string());
                    Ok(ResponseDeltaAnd(Some(ResponseDelta::MessageDelta{
                        usage, title: None, stop_reason: "(none?)".to_string() }), warnings))
                }
            },
            "message-stop" => Ok(ResponseDeltaAnd(Some(ResponseDelta::MessageStop), warnings)),
            _ => unreachable!("response delta impl deserialize kind"),
        }
    }
}

struct ResponseDeltaAnd(Option<ResponseDelta>, Vec<String>);
impl<'de> Deserialize<'de> for ResponseDeltaAnd {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ResponseDeltaDeserializeVisitor)
    }
}

struct ResponseData {
    message_id: String,
    model: String,
    initial_usage: String,
    content: Vec<ContentBlock>,
    stop_reason: String,
    title: Option<String>,
    result_usage: String,
}
struct ResponseBuilder {
    data: ResponseData,
    started: bool, // message started
    stopped: bool, // message stopped
    // started and not completed blocks
    active_blocks: HashMap<usize, ContentBlock>,
    // content-block.tool-use.input is json value, but delta event only
    // provides stringified segments, so need a separate string builder to store them
    json_builders: HashMap<usize, String>,
    // completed blocks, not sure whether will receive blocks by index,
    // so completed blocks still need map and validate index gap after complete
    completed_blocks: HashMap<usize, ContentBlock>,
    // try collect errors and continue handling to end of the stream
    warnings: Vec<String>,
}
impl ResponseBuilder {

    fn new() -> Self {
        Self {
            // new with default value is easier to use than a mutable Option
            data: ResponseData {
                message_id: String::new(),
                model: String::new(),
                initial_usage: String::new(),
                content: Vec::new(),
                stop_reason: String::new(),
                title: None,
                result_usage: String::new(),
            },
            started: false,
            stopped: false,
            active_blocks: HashMap::new(),
            json_builders: HashMap::new(),
            completed_blocks: HashMap::new(),
            warnings: Vec::new(),
        }
    }

    // no expected error, all collected and try continue
    fn handle(&mut self, event: ServerSentEvent) {
        // use event.data as message header, it is generally short and distinguishable
        macro_rules! raise { ($($arg:tt)*) => {{ self.warnings.push(format!($($arg)*)); }} }

        // remaining deserialize errors are basic type mismstach, e.g. expect string, meet object
        let Ok(ResponseDeltaAnd(delta, warnings)) = serde_json::from_str(&event.data)
            .map_err(|e| raise!("{}: deserialize error: {}", event.data, e)) else { return; };
        self.warnings.extend(warnings);
        let Some(delta) = delta else { return; }; // if it's none, warning message should already emitted
        
        let delta_type_name = match delta {
            ResponseDelta::Ping => "ping",
            ResponseDelta::MessageStart{..} => "message_start",
            ResponseDelta::ContentStart{..} => "content_block_start",
            ResponseDelta::ContentDelta{..} => "content_block_delta",
            ResponseDelta::ContentStop{..} => "content_block_stop",
            ResponseDelta::MessageDelta{..} => "message_delta",
            ResponseDelta::MessageStop => "message_stop",
        };
        if let Some(event_name) = event.name && event_name != delta_type_name {
            raise!("{}: name and data.type mismatch, {} != {}", event.data, event_name, delta_type_name);
        }
        // return: no need to action after message stopped
        if self.stopped { raise!("{}: unexpected event after message stopped", event.data); return; }

        match delta {
            // ping is allowed anywhere while no action for that
            ResponseDelta::Ping => {},
            // normal first event
            ResponseDelta::MessageStart{ id, model, usage } if !self.started => {
                self.started = true;
                self.data.message_id = id;
                self.data.model = model;
                self.data.initial_usage = usage;
            },
            ResponseDelta::MessageStart{..} /* if started */ => raise!("{}: duplicate message_start event", event.data),
            // use this to reject all other events before started
            // no need to return, you can still operate content blocks regardless of message started?
            _ if !self.started =>
                raise!("{}: unexpected event {} before message_start", event.data, delta_type_name),
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
                    (ContentBlockDelta::Text{ text: text_delta }, ContentBlock::Text { value, .. }) => {
                        print!("{}", text_delta); value.push_str(&text_delta);
                    },
                    (ContentBlockDelta::Thinking{ thinking: thinking_delta }, ContentBlock::Thinking{ value, .. }) => {
                        print!("{}", thinking_delta); value.push_str(&thinking_delta);
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
                        raise!("{}: block {} stopped before any content? (1)", event.data, index),
                    ContentBlock::Thinking{ value, .. } if value.is_empty() =>
                        raise!("{}: block {} stopped before any content? (2)", event.data, index),
                    ContentBlock::ToolUse{ input, .. } => {
                        if let Some(builder) = self.json_builders.remove(&index) {
                            if builder.is_empty() {
                                raise!("{}: block {} stopped before any content? (4)", event.data, index);
                            } else {
                                match serde_json::from_str(&builder) {
                                    Ok(v) => *input = v,
                                    Err(e) => raise!("{}: failed to parse json after tool input content stop: {}", event.data, e),
                                }
                            }
                        } else {
                            raise!("{}: block {} stopped before any content? (3)", event.data, index);
                        }
                    },
                    _ => {}, // ok if they are not empty
                }
                self.completed_blocks.insert(index, block);
            },
            ResponseDelta::MessageDelta{ stop_reason, usage, title } => {
                self.data.stop_reason = stop_reason;
                self.data.result_usage = usage;
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
            self.warnings.push("assembler not started when stream end?".to_string());
        }
        if !self.stopped {
            self.warnings.push("assembler not stopped when stream end?".to_string());
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
    // already validated parent message role relationship, only need validated starting message role
    if !thread.is_empty() && thread[0].role.is_assistant() {
        let thread_ids = thread.iter().map(|m| format!("{}({:?})", m.id, m.role)).collect::<Vec<_>>();
        bail!("thread not start with user message, thread: {:?}", thread_ids);
    }
    // validate tool names
    let unknown_tool_names = parameters.config.tool_names.iter()
        .map(|n| n.as_str())
        .filter(|n| !ALL_TOOLS.iter().any(|e| &e.name == n)).collect::<Vec<_>>();
    if !unknown_tool_names.is_empty() {
        bail!("unknown tool names {}", unknown_tool_names.join(","));
    }

    let request_body = RequestSerializeHelper{
        config: &parameters.config,
        system: parameters.session.system_message.as_ref(),
        thread,
    };
    fs::write("request.json", &serde_json::to_string_pretty(&request_body)?)?;
    if parameters.dry { bail!("this is dry run, use --not-dry to actually run"); }
    bail!("hard dry");
    
    let base_url = parameters.config.base_url.as_deref().unwrap_or("https://api.deepseek.com/anthropic");
    let mut url = reqwest::Url::parse(&base_url)?;
    let path_name = std::path::PathBuf::from(url.path()).join("v1/messages");
    let path_name = path_name.to_str().ok_or_else(|| anyhow::anyhow!("failed to create request url?"))?;
    url.set_path(path_name);

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
    let mut builder = ResponseBuilder::new();

    let mut raw_chunks = Vec::new();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else { println!("failed to ? a chunk?"); continue };
        raw_chunks.push(String::from_utf8_lossy(chunk.as_ref()).into_owned());
        parser.push(chunk);
        while let Some(event) = parser.pull()? {
            builder.handle(event);
        }
    }
    builder.end();

    // unwrap: provided nanosecond is valid
    let complete_time = Utc::now().with_nanosecond(0).unwrap();
    if !builder.warnings.is_empty() {
        builder.warnings.iter().for_each(|e| eprintln!("{}", e));
    }
    let response_log = raw_chunks.into_iter().chain(builder.warnings.into_iter()).collect::<Vec<_>>().join("\n");
    if let Err(error) = fs::write("response.log", &response_log) {
        eprintln!("failed to write response.log: {}", error);
        eprintln!("{}", response_log);
    }

    // println!("{:?}", assembler.message);
    let response_data = builder.data;
    // unwrap: session.messages is not empty
    let result_message_id = parameters.session.messages.iter().map(|m| m.id).max().unwrap() + 1;

    let mut additional = Vec::new();
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
            usage: format!("{}, {}", response_data.initial_usage, response_data.result_usage),
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
        let mut builder = ResponseBuilder::new();

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
                builder.handle(event);
            }
        }
        builder.end();
        assert!(builder.started);
        assert!(builder.stopped);
        assert_eq!(builder.warnings, Vec::<String>::new());
        assert_eq!(builder.data.message_id, "e6ef6a63-a078-4f53-a73b-38c8d1d46310");
        assert_eq!(builder.data.model, "deepseek-flash");
        // json parse and serialize make properties reorder TODO change to compare json
        assert_eq!(builder.data.initial_usage, "{\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"input_tokens\":12,\"output_tokens\":0,\"service_tier\":\"standard\"}");
        assert_eq!(builder.data.content.len(), 1);
        let ContentBlock::Text{ value, name } = &builder.data.content[0] else {
            panic!("content[0] is not text");
        };
        assert!(name.is_none());
        assert_eq!(value, "Hello!");
        assert_eq!(builder.data.stop_reason, "end_turn");
        assert_eq!(builder.data.result_usage, "{\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"input_tokens\":12,\"output_tokens\":3,\"service_tier\":\"standard\"}");
        assert!(builder.data.title.is_none());
    }

    #[test]
    fn test_build_response_2() {

        let mut parser = EventStreamParser::new();
        let mut builder = ResponseBuilder::new();

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

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":13516,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":4617,"service_tier":"standard","output_tokens_details":{"thinking_tokens":3467}}}

event: message_stop
data: {"type":"message_stop"}

"###].map(|c| Bytes::from_static(c)) {
            parser.push(chunk);
            while let Some(event) = parser.pull().expect("parser pull failed") {
                builder.handle(event);
            }
        }
        builder.end();
        assert!(builder.started);
        assert!(builder.stopped);
        assert_eq!(builder.warnings, Vec::<String>::new());
        assert_eq!(builder.data.message_id, "bdc3");
        assert_eq!(builder.data.model, "deepseek-flash");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&builder.data.initial_usage).expect("failed to parse"),
            serde_json::json!({"input_tokens":13516,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}));
        assert_eq!(builder.data.content.len(), 2);
        let ContentBlock::Thinking{ value, signature } = &builder.data.content[0] else {
            panic!("content[0] is not text");
        };
        assert_eq!(value, "Now I have ( scalars, all], including `l-empty(n nb- c-byte-order-mark` ( `c-print `s).\n` =ES spaces (`s).\n\nSo — on\"?actly;om-l\\nt than n).) => detectedliteral\" has-white515203.");
        // oh good, signature is same as message id
        assert_eq!(signature, "bdc3");
        let ContentBlock::Text{ value, name } = &builder.data.content[1] else {
            panic!("content[1] is not text");
        };
        assert!(name.is_none());
        assert_eq!(value, "## Answerpace(nextra**).");
        assert_eq!(builder.data.stop_reason, "end_turn");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&builder.data.result_usage).expect("failed to parse"),
            serde_json::json!({"input_tokens":13516,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":4617,"service_tier":"standard","output_tokens_details":{"thinking_tokens":3467}}));
        assert!(builder.data.title.is_none());
    }
}
