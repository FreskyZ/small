use std::collections::HashSet;
use std::fmt;
use anyhow::Result;
use serde::{Serialize, Serializer, Deserialize, Deserializer};
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Unexpected};
use serde::de::{Error as DeserializeError, Visitor as DeserializeVisitor};
use serde::ser::{Error as SerializeError, SerializeMap as _, SerializeSeq as _};
use crate::session::{Session, Message, SystemMessage, ResponseMetadata, RequestConfig};
use crate::session::{Thinking, Role, ContentBlock};

// text representation, serializing and deserializing

// without serde(rename), you use this
// while this is not used in text repr, this is used in response data deserialization
impl Serialize for Role {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        serializer.serialize_str(if self.is_user() {"user" } else { "assitant" })
    }
}

// now that this is a dedicated serde module, you can move visitors out to reduce indention
struct RoleVisitor;
impl<'de> DeserializeVisitor<'de> for RoleVisitor {
    type Value = Role;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("role")
    }
    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> where E: DeserializeError, {
        match v {
            "user" => Ok(Role::User),
            "assistant" => Ok(Role::Assistant),
            other => Err(DeserializeError::invalid_value(Unexpected::Str(other), &"role")),
        }
    }
}
impl<'de> Deserialize<'de> for Role {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_str(RoleVisitor)
    }
}

// merge trailing whitespace records into trimmed value, the records are created by side_load function
fn merge_trailing_whitespace_records(trimmed_value: &str, records: Vec<(usize, String)>) -> Result<String, String> {
    let mut b = String::new();
    let mut records = records;
    // NOTE this can \n because the content is guaranteed to \n
    for (line_index, line) in trimmed_value.lines().enumerate() {
        b.push_str(line);
        if let Some(record_index) = records.iter().position(|r| r.0 == line_index) {
            // use remove for later easy to check records should be empty
            b.push_str(&records.remove(record_index).1);
        }
        b.push('\n');
    }
    // pop last redundent newline
    b.pop();
    if !records.is_empty() {
        return Err(format!("side map line number out of range {:?}", records.into_iter().map(|r| r.0).collect::<Vec<_>>()));
    }
    Ok(b)
}

// to collect value from value+whitespace multiple keys, you must custom deserialize
// include some validations here by the way to improve source location reporting compare to later validation function
// self.0 is none for system message
struct ContentBlockVisitor(Option<Role>);
impl<'de> DeserializeVisitor<'de> for ContentBlockVisitor {
    type Value = ContentBlock;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("content block")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut kind: Option<&'static str> = None;
        let mut name = None;
        let mut value = None;
        let mut whitespace = None;
        let mut signature = None;
        let mut tool_use_id = None;
        let mut tool_use_input = None;
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                "kind" => {
                    kind = match (map.next_value::<&str>()?, self.0) {
                        ("text", _) => Some("text"),
                        ("think", Some(Role::Assistant)) => Some("think"),
                        ("tool-use", Some(Role::Assistant)) => Some("tool-use"),
                        ("tool-result", Some(Role::User)) => Some("tool-result"),
                        (other, _) => return Err(DeserializeError::unknown_variant(other, match self.0 {
                            None => &["text"], // system
                            Some(Role::User) => &["text", "tool-result"],
                            Some(Role::Assistant) => &["text", "think", "tool-use"],
                        })),
                    };
                },
                other if kind.is_none() => return Err(DeserializeError::unknown_field(other, &["kind before other fields"])),
                "name" if matches!(kind, Some("text" | "tool-use")) => name = Some(map.next_value()?),
                // this next_value::<&str> is unacceptable?
                "value" if matches!(kind, Some("text" | "think" | "tool-result")) => value = Some(map.next_value::<String>()?),
                // whitespace records is inline json
                "whitespace" if matches!(kind, Some("text" | "think" | "tool-result")) =>
                    whitespace = Some(serde_json::from_str::<Vec<(usize, String)>>(map.next_value::<&str>()?)
                        .map_err(|e| DeserializeError::invalid_value(Unexpected::Str(&format!("{}", e)), &"valid json value"))?),
                "signature" if kind == Some("think") => signature = Some(map.next_value()?),
                "id" if matches!(kind, Some("tool-use" | "tool-result")) => tool_use_id = Some(map.next_value()?),
                // tool use input is inline json
                "input" if kind == Some("tool-use") =>
                    tool_use_input = Some(serde_json::from_str::<serde_json::Value>(map.next_value::<&str>()?)
                        .map_err(|e| DeserializeError::invalid_value(Unexpected::Str(&format!("{}", e)), &"valid json value"))?),
                // no need to precisely read tool execution metadata
                "metadata" if kind == Some("tool-result") => { map.next_value::<IgnoredAny>()?; },
                other => return Err(DeserializeError::unknown_field(other, match kind {
                    None => unreachable!(),
                    Some("text") => &["name", "value", "whitespace"],
                    Some("think") => &["value", "signature", "whitespace"],
                    Some("tool-use") => &["id", "name", "input"],
                    Some("tool-result") => &["id", "value", "whitespace", "metadata"],
                    Some(_) => unreachable!(),
                })),
            }
        }

        let Some(kind) = kind else { return Err(DeserializeError::missing_field("kind")) };
        // tool-use don't use value, process first
        if kind == "tool-use" {
            let Some(id) = tool_use_id else { return Err(DeserializeError::missing_field("id")) };
            let Some(name) = name else { return Err(DeserializeError::missing_field("name")) };
            let Some(input) = tool_use_input else { return Err(DeserializeError::missing_field("input")) };
            return Ok(ContentBlock::ToolUse{ id, name, input });
        }

        // check value before whitespace don't have trailing whitespaces
        let Some(value) = value else { return Err(DeserializeError::missing_field("value")) };
        if value.trim().len() != value.len() {
            return Err(DeserializeError::invalid_value(Unexpected::Str("leading or trailing whitespaces"), &"none"));
        } else if let Some(position) = value.find(" \n") {
            return Err(DeserializeError::invalid_value(Unexpected::Str(&format!("intermediate trailing whitespaces, {}", position)), &"none"));
        }
        // then merge whitespace records
        let value = if let Some(whitespace) = whitespace {
            merge_trailing_whitespace_records(&value, whitespace)
                .map_err(|e| DeserializeError::custom(&format!("failed to side unload: {}", e)))?
        } else { value.to_string() };

        match kind {
            "text" => Ok(ContentBlock::Text{ name, value }),
            "think" => Ok(ContentBlock::Thinking{
                value,
                signature: signature.ok_or_else(|| DeserializeError::missing_field("signature"))?,
            }),
            "tool-result" => Ok(ContentBlock::ToolResult{
                id: tool_use_id.ok_or_else(|| DeserializeError::missing_field("id"))?,
                value,
                metadata: Vec::new(),
            }),
            _ => unreachable!(),
        }
    }
}
// self.0 is none for system message
struct ContentBlockSeed(Option<Role>);
impl<'de> DeserializeSeed<'de> for ContentBlockSeed {
    type Value = ContentBlock;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ContentBlockVisitor(self.0))
    }
}

// self.0 is none for system message
struct ContentVisitor(Option<Role>);
impl<'de> DeserializeVisitor<'de> for ContentVisitor {
    type Value = Vec<ContentBlock>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("message content")
    }
    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> where E: DeserializeError {
        Ok(vec![ContentBlock::Text{ name: None, value: v.to_string() }])
    }
    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error> where A: SeqAccess<'de> {
        let mut results = Vec::new();
        while let Some(element) = seq.next_element_seed(ContentBlockSeed(self.0))? {
            results.push(element);
        }
        Ok(results)
    }
}
// self.0 is none for system message
struct ContentSeed(Option<Role>);
impl<'de> DeserializeSeed<'de> for ContentSeed {
    type Value = Vec<ContentBlock>;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_any(ContentVisitor(self.0))
    }
}

// split trailing whitespaces into a side map, for last line, also include trailing empty lines
fn side_load_trailing_whitespaces(original_value: &str) -> (String, Vec<(usize, String)>) {

    let mut b = String::new();
    let mut records = Vec::new();
    // this assignment of 0 will not be used, .split result has at least 1 element
    let mut last_line_index = 0;
    let without_last_trailing_whitespace = original_value.trim_ascii_end();

    // ATTENTION not .lines() because that automatically 
    // handles \r\n and if you regard all as \n that is binary change
    for (line_index, line) in without_last_trailing_whitespace.split('\n').enumerate() {
        let trimmed = line.trim_ascii_end();
        if trimmed.len() != line.len() {
            records.push((line_index, line[trimmed.len()..].to_string()));
        }
        b.push_str(trimmed);
        b.push('\n');
        last_line_index = line_index;
    }
    // pop last \n, it must pop something because .split result has at least 1 element
    b.pop();
    if without_last_trailing_whitespace.len() != original_value.len() {
        records.push((last_line_index, original_value[without_last_trailing_whitespace.len()..].to_string()));
    }
    (b, records)
}

// to map value into value+whitespace 2 map keys, you must use a custom serialize
struct ContentBlockAsTextRepr<'a>(&'a ContentBlock);
impl<'a> Serialize for ContentBlockAsTextRepr<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(None)?;
        match self.0 {
            ContentBlock::Text{ name, value } => {
                map.serialize_entry("kind", "text")?;
                if let Some(name) = name { map.serialize_entry("name", name)?; }
                let (trimmed_value, whitespace) = side_load_trailing_whitespaces(&value);
                if whitespace.is_empty() {
                    map.serialize_entry("value", &value)?;
                } else {
                    map.serialize_entry("value", &trimmed_value)?;
                    map.serialize_entry("whitespace", &serde_json::to_string(&whitespace).map_err(|e| SerializeError::custom(e))?)?;
                }
            },
            ContentBlock::Thinking{ value, signature } => {
                map.serialize_entry("kind", "think")?;
                let (trimmed_value, whitespace) = side_load_trailing_whitespaces(&value);
                if whitespace.is_empty() {
                    map.serialize_entry("value", &value)?;
                } else {
                    map.serialize_entry("value", &trimmed_value)?;
                    map.serialize_entry("whitespace", &serde_json::to_string(&whitespace).map_err(|e| SerializeError::custom(e))?)?;
                }
                map.serialize_entry("signature", signature)?;
            },
            ContentBlock::ToolUse{ id, name, input } => {
                map.serialize_entry("kind", "tool-use")?;
                map.serialize_entry("id", id)?;
                map.serialize_entry("name", name)?;
                map.serialize_entry("input", &serde_json::to_string(input).map_err(|e| SerializeError::custom(e))?)?;
            },
            ContentBlock::ToolResult{ id, value, metadata } => {
                map.serialize_entry("kind", "tool-result")?;
                map.serialize_entry("id", id)?;
                let (trimmed_value, whitespace) = side_load_trailing_whitespaces(&value);
                if whitespace.is_empty() {
                    map.serialize_entry("value", &value)?;
                } else {
                    map.serialize_entry("value", &trimmed_value)?;
                    map.serialize_entry("whitespace", &serde_json::to_string(&whitespace).map_err(|e| SerializeError::custom(e))?)?;
                }
                map.serialize_entry("metadata", &serde_json::to_string(&metadata).map_err(|e| SerializeError::custom(e))?)?;
            },
        }
        map.end()
    }
}

struct ContentAsTextRepr<'a>(&'a [ContentBlock]);
impl<'a> Serialize for ContentAsTextRepr<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for element in self.0 {
            seq.serialize_element(&ContentBlockAsTextRepr(element))?;
        }
        seq.end()
    }
}

struct ThinkingVisitor;
impl<'de> DeserializeVisitor<'de> for ThinkingVisitor {
    type Value = Thinking;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("thinking mode")
    }
    fn visit_bool<E>(self, v: bool) -> Result<Self::Value, E> where E: DeserializeError {
        Ok(Thinking::Switch(v))
    }
    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> where E: DeserializeError {
        match v {
            "low" => Ok(Thinking::Effort("low")),
            "high" => Ok(Thinking::Effort("high")),
            "max" => Ok(Thinking::Effort("max")),
            other => Err(DeserializeError::invalid_value(Unexpected::Str(other), &"true, false, low, high, max")),
        }
    }
}
impl<'de> Deserialize<'de> for Thinking {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_any(ThinkingVisitor)
    }
}

// now that request config don't have a message id, you need to put them together for a result type
struct RequestConfigAndId {
    config: RequestConfig,
    message_id: usize,
}
struct RequestConfigVisitor;
impl<'de> DeserializeVisitor<'de> for RequestConfigVisitor {
    type Value = RequestConfigAndId;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("request config")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut message_id = None;
        let mut base_url = None;
        let mut model = None;
        let mut title = None;
        let mut thinking = None;
        let mut tool_names = None;
        let mut max_tokens = None;
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                "message-id" => message_id = Some(map.next_value()?),
                "base-url" => base_url = Some(map.next_value::<&str>()?),
                "model" => model = Some(map.next_value::<&str>()?),
                "title" => title = Some(map.next_value()?),
                "think" => thinking = Some(map.next_value()?),
                // can vec string be here?
                "tools" => tool_names = Some(map.next_value()?),
                "max-tokens" => max_tokens = Some(map.next_value()?),
                other => return Err(DeserializeError::unknown_field(other,
                    &["message-id", "base-url", "model", "title", "think", "tools", "max-tokens"])),
            }
        }
        let Some(message_id) = message_id else { return Err(DeserializeError::missing_field("message-id")); };
        if let Some(base_url) = &base_url && let Err(error) = reqwest::Url::parse(base_url) {
            return Err(DeserializeError::invalid_value(Unexpected::Str(&format!("{:?}", error)), &"valid url"));
        }
        if let Some(model) = &model && !matches!(*model, "deepseek-flash" | "deepseek-v4-pro") {
            return Err(DeserializeError::invalid_value(Unexpected::Str(model), &"known model name"));
        }
        if let Some(max_tokens) = max_tokens && max_tokens <= 0 {
            return Err(DeserializeError::invalid_value(Unexpected::Unsigned(max_tokens), &"positive value"));
        }
        Ok(RequestConfigAndId{ message_id, config: RequestConfig {
            base_url: base_url.map(|u| u.to_string()),
            model: model.map(|m| m.to_string()),
            title: title.unwrap_or(false),
            thinking: thinking.unwrap_or(Thinking::default()),
            tool_names: tool_names.unwrap_or_default(),
            max_tokens: max_tokens.map(|v| v as usize),
        } })
    }
}
impl<'de> Deserialize<'de> for RequestConfigAndId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(RequestConfigVisitor)
    }
}
impl Serialize for RequestConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut map = serializer.serialize_map(None)?;
        if let Some(base_url) = &self.base_url { map.serialize_entry("base-url", base_url)?; }
        if let Some(model) = &self.model { map.serialize_entry("model", model)?; }
        if self.title { map.serialize_entry("title", &true)?; }
        match self.thinking {
            Thinking::Switch(false) => {}, // skip default
            Thinking::Switch(true) => { map.serialize_entry("think", &true)?; },
            Thinking::Effort(effort) => { map.serialize_entry("think", effort)?; },
        }
        if !self.tool_names.is_empty() { map.serialize_entry("tools", &self.tool_names)?; }
        if let Some(max_tokens) = &self.max_tokens { map.serialize_entry("max-tokens", max_tokens)?; }
        map.end()
    }
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
        map.serialize_entry("provider-message-id", &self.provider_message_id)?;
        map.serialize_entry("stop-reason", &self.stop_reason)?;
        map.serialize_entry("usage", &self.usage)?;
        for (key, value) in &self.additional {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

struct MessageVisitor(MessageDeserializeSeed);
impl<'de> DeserializeVisitor<'de> for MessageVisitor {
    // for system message, return its content in message.content
    type Value = Message;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("message body")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut content = None;
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                "content" => content = Some(map.next_value_seed(
                    ContentSeed(if self.0.id > 0 { Some(self.0.role) } else { None }))?),
                // no need to deserialize request and response information of completed assistant message
                "request" => { map.next_value::<IgnoredAny>()?; },
                "response" => { map.next_value::<IgnoredAny>()?; },
                other => return Err(DeserializeError::unknown_field(other, &["content", "request", "response"])),
            }
        } 
        let Some(content) = content else { return Err(DeserializeError::missing_field("content")); };
        let MessageDeserializeSeed{ role, id, parent_id } = self.0;
        // cannot spread with different type: ..self.0
        Ok(Message{ role, id, parent_id, content, request_config: None, response_metadata: None })
    }
}
struct MessageDeserializeSeed {
    role: Role, 
    id: usize,
    parent_id: Option<usize>,
}
impl MessageDeserializeSeed {
    // don't have role::system, use id = 0 to check is system
    fn from_system() -> Self { Self { role: Role::User, id: 0, parent_id: None } }

    // the serde::de::Error is a trait, in deserialize and visitor implementation,
    // it will call concrete deserializer's error type, that mean this outside function also need D and 'de
    // no, Visitor impl don't know Deserialize type, just let it pass a Error type is enough
    fn from_key<E>(key: &str) -> Result<Self, E> where E: DeserializeError {
        let role = if key.starts_with("user") { Role::User } else { Role::Assistant };

        // TODO temp compatible to test other things
        let (id, parent_id) = if key.ends_with(']') {
            let mut split = key[role.display().len() + 1..key.len() - 1].trim().split("<-");
            // unwrap: split have at least 1 element
            let id = split.next().unwrap().parse().map_err(|_| E::invalid_value(Unexpected::Str(key), &"message id"))?;
            if id <= 0 { return Err(E::invalid_value(Unexpected::Str(key), &"positive value")) }

            let parent_id = split.next().map(|pid| {
                let pid = pid.parse::<usize>().map_err(|_| E::invalid_value(Unexpected::Str(key), &"message parent id"))?;
                if pid <= 0 { return Err(E::invalid_value(Unexpected::Str(key), &"positive value")) }
                else if id == pid { return Err(E::invalid_value(Unexpected::Str(key), &"parent id not same as message id")) }
                Ok(pid)
            }).transpose()?;
            (id, parent_id)
        } else {
            let mut split = key[role.display().len() + 1..].trim().split('>');
            // unwrap: split have at least 1 element
            let id = split.next().unwrap().parse().map_err(|_| E::invalid_value(Unexpected::Str(key), &"message id"))?;
            if id <= 0 { return Err(E::invalid_value(Unexpected::Str(key), &"positive value")) }

            let parent_id = split.next().map(|pid| {
                let pid = pid.parse::<usize>().map_err(|_| E::invalid_value(Unexpected::Str(key), &"message parent id"))?;
                if pid <= 0 { return Err(E::invalid_value(Unexpected::Str(key), &"positive value")) }
                else if id == pid { return Err(E::invalid_value(Unexpected::Str(key), &"parent id not same as message id")) }
                Ok(pid)
            }).transpose()?;
            (id, parent_id)
        };

        if role.is_assistant() && parent_id.is_none() {
            return Err(E::invalid_value(Unexpected::Str(key), &"assistant message to have parent id"));
        }
        Ok(MessageDeserializeSeed{ role, id, parent_id })
    }
}
impl<'de> DeserializeSeed<'de> for MessageDeserializeSeed {
    type Value = Message;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(MessageVisitor(self))
    }
}

// custom serialize does not directly support nested map, that mean you need this
struct MessageBody<'a>(&'a Message);
impl<'a> Serialize for MessageBody<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let size = 1
            + if self.0.request_config.is_some() { 1 } else { 0 }
            + if self.0.response_metadata.is_some() { 1 } else { 0 };
        let mut map = serializer.serialize_map(Some(size))?;
        map.serialize_entry("content", &ContentAsTextRepr(&self.0.content))?;
        if let Some(request_config) = &self.0.request_config {
            map.serialize_entry("request", request_config)?;
        }
        if let Some(response_metadata) = &self.0.response_metadata {
            map.serialize_entry("response", response_metadata)?;
        }
        map.end()
    }
}
// this serialize a document that include message key and value
impl Serialize for Message {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        // you have lifetime errors for simple single usize value ??
        // let parent_id = if let Some(v) = self.parent_id { format_args!("<-{}", v) } else { format_args("") };
        let key = format!("{} {}{}", self.role.display(), self.id,
            if let Some(v) = self.parent_id { format!(">{}", v) } else { String::new() });
        let mut map = serializer.serialize_map(Some(1))?;
        map.serialize_entry(&key, &MessageBody(self))?;
        map.end()
    }
}
pub fn to_string(message: &Message) -> Result<String> {
    Ok(serde_yaml_ng::to_string(message)?)
}

// now that session don't have a request config, you need to put them together for a result type
struct SessionAndRequestConfigAndId {
    session: Session,
    request_config: Option<RequestConfigAndId>,
}
struct SessionVisitor;
impl<'de> DeserializeVisitor<'de> for SessionVisitor {
    type Value = SessionAndRequestConfigAndId;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("session")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut name = None;
        let mut system_message = None;
        let mut messages = Vec::new();
        let mut request_config = None;
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                "name" => name = Some(map.next_value()?),
                // metadata key may vary, no need to precisely read them
                "metadata" => { map.next_value::<IgnoredAny>()?; },
                "system" => system_message = Some(map.next_value_seed(MessageDeserializeSeed::from_system())?),
                key if key.starts_with("user") || key.starts_with("assistant") =>
                    messages.push(map.next_value_seed(MessageDeserializeSeed::from_key(key)?)?),
                "request" => request_config = Some(map.next_value()?),
                other => return Err(DeserializeError::unknown_field(other, &["name", "user", "assistant", "request"])),
            }
        }
        let name = name.ok_or_else(|| DeserializeError::missing_field("name"))?;
        let system_message = system_message.map(|m| SystemMessage{ content: m.content });
        if messages.is_empty() { return Err(DeserializeError::missing_field("user or assistant")); }
        Ok(SessionAndRequestConfigAndId { session: Session { name, system_message, messages }, request_config })
    }
}
impl<'de> Deserialize<'de> for SessionAndRequestConfigAndId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(SessionVisitor)
    }
}

// don't provide intermediate types
pub fn from_str(file_name: &str, original_value: &str) -> Result<(Session, Option<(RequestConfig, usize)>)> {

    let mut errors = Vec::new();
    macro_rules! raise { ($($arg:tt)*) => {{ errors.push(format!($($arg)*)); }} }

    // don't validate overall leading and trailing whitespace,
    // it's normal to have trailing new line, it's common to have leading and trailing empty lines
    if let Some(position) = original_value.trim().find(" \n") {
        raise!("{}: unexpected intermediate trailing whitespace, byte index {}", file_name, position);
    }

    let SessionAndRequestConfigAndId { session, request_config } = serde_yaml_ng::from_str(original_value)?;

    // 1. duplicate message id
    let mut message_ids = HashSet::new();
    for message in &session.messages {
        if !message_ids.insert(message.id) {
            raise!("message[{}]: duplicate message id", message.id);
        }
    }

    // 2. parent id and parent role relationship
    for message in &session.messages {
        if let Some(parent_id) = message.parent_id {
            if let Some(parent_message) = session.messages.iter().find(|m| m.id == parent_id) {
                if !matches!((&message.role, &parent_message.role), (Role::User,  Role::Assistant) | (Role::Assistant, Role::User)) {
                    raise!("message[{}]: unexpected parent message role relationship", message.id);
                }
            } else {
                raise!("message[{}]: parent-id {} not exist", message.id, parent_id);
            }
        }
    }

    // 4. tool use id reference and thinking switch
    for message in session.messages.iter().filter(|m| m.role.is_user()) {
        let Some(parent_id) = message.parent_id else { continue; };
        // already raised error
        let Some(parent_message) = session.messages.iter().find(|m| m.id == parent_id) else { continue; };

        let mut tool_use_ids = parent_message.content.iter().fold(HashSet::new(),
            |mut acc, block| { if let ContentBlock::ToolUse{ id, .. } = block { acc.insert(id); } acc });
        for (block_index, block) in message.content.iter().enumerate() {
            if let ContentBlock::ToolResult{ id, .. } = block {
                if !tool_use_ids.remove(id) {
                    raise!("message[{}].content[{}]: tool use id not found in parent message tool use ids, {}, {:?}",
                        message.id, block_index, id, tool_use_ids);
                }
            }
        }
        if tool_use_ids.is_empty() {
            raise!("message[{}]: parent message tool use id not fully responded, remaining {:?}", message.id, tool_use_ids);
        }
        let parent_message_thinking = parent_message.content.iter().any(|c| matches!(c, ContentBlock::Thinking{..}));
        if let Some(RequestConfigAndId{ config, message_id }) = &request_config && message_id == &message.id {
            if parent_message_thinking != !matches!(config.thinking, Thinking::Switch(false)) {
                raise!("message[{}]: thinking switch is different from parent message, {}", message.id, parent_message_thinking);
            }
        }
    }
    
    // 5. request config message id
    if let Some(RequestConfigAndId{ message_id, .. }) = &request_config {
        if let Some(message) = session.messages.iter().find(|m| m.id == *message_id) {
            if !message.role.is_user() {
                raise!("request.message-id: message {} should be user message", message_id);
            }
        } else {
            raise!("request.message-id: message id {} not exist", message_id);
        }
    }

    Ok((session, request_config.map(|r| (r.config, r.message_id))))
}

#[test]
fn test_read() {
    use std::assert_matches;

    let (session, request_config) = from_str("filename", &vec![
        "name: session name",
        "metadata: 2026-10-22T07:59:01Z",
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
        "    create-time: 1",
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
        "    value: |-",
        "      use std::fs...",
        "      ...",
        "      struct Message...",
        "",
        "      fn read_session...",
        "      fn test_read...",
        "    metadata:",
        "      create-time: 2",
        "      complete-time: etc.1",
        "      file-size: etc.2",
        "      return-size: etc.3",
        "      git-version: etc.4",
        "  - kind: tool-result",
        "    id: tool-call-id-2",
        "    value: |-",
        "      use std::collections::{HashMap, BinaryHeap};...",
        "      ...",
        "",
        "request:",
        "  message-id: 4",
        "  model: deepseek-v4-pro",
        "  think: true",
        "  tools: [read-file]",
    ].join("\n")).expect("deserialization failed");

    assert_eq!(session.name, "session name");
    let Some(system_message) = &session.system_message else {
        panic!("session.system_message is none")
    };
    assert_eq!(system_message.content.len(), 1);
    let ContentBlock::Text{ name, value } = &system_message.content[0] else {
        panic!("session.system_message.content is not text");
    };
    assert!(name.is_none());
    assert_eq!(value, "You are a coding agent");
    assert_eq!(session.messages.len(), 3);
    assert_eq!(session.messages[0].id, 1);
    assert_eq!(session.messages[0].parent_id, None);
    assert_matches!(session.messages[0].role, Role::User);
    assert!(session.messages[0].request_config.is_none());
    assert!(session.messages[0].response_metadata.is_none());
    assert_eq!(session.messages[0].content.len(), 1);
    let ContentBlock::Text{ name, value } = &session.messages[0].content[0] else {
        panic!("session.messages[0].content is not plain text");
    };
    assert!(name.is_none());
    assert_eq!(value, "summary source code file src/main.rs");
    assert_eq!(session.messages[1].id, 3);
    assert_eq!(session.messages[1].parent_id, Some(1));
    assert_matches!(session.messages[1].role, Role::Assistant);
    assert_eq!(session.messages[1].content.len(), 4);
    assert_matches!(&session.messages[1].content[0], ContentBlock::Thinking{ value, .. } if value == "reasoning content");
    assert_matches!(&session.messages[1].content[1], ContentBlock::Text{ value, .. } if value == "normal content");
    let ContentBlock::ToolUse{ id, name, input } = &session.messages[1].content[2] else {
        panic!("session.messages[1].content[2] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(name, "read-file");
    assert_eq!(input, &serde_json::json!({ "pathname": "src/main.rs" }));
    let ContentBlock::ToolUse{ id, name, input } = &session.messages[1].content[3] else {
        panic!("session.messages[1].content[3] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(name, "read-file");
    assert_eq!(input, &serde_json::json!({ "pathname": "src/session.rs" }));
    // read don't read response metadata
    assert!(session.messages[1].request_config.is_none());
    assert!(session.messages[1].response_metadata.is_none());
    
    assert_eq!(session.messages[2].id, 4);
    assert_eq!(session.messages[2].parent_id, Some(3));
    assert_matches!(session.messages[2].role, Role::User);
    assert_eq!(session.messages[2].content.len(), 3);
    assert_matches!(&session.messages[2].content[0], ContentBlock::Text{ value, name }
        if name.as_deref() == Some("additional-manual-description") && value == "additional manual description");
    let ContentBlock::ToolResult{ id, value, metadata } = &session.messages[2].content[1] else {
        panic!("session.messages[2].content[1] not toolcall");
    };
    assert_eq!(id, "tool-call-id-1");
    assert_eq!(value, "use std::fs...\n...\nstruct Message...\n\nfn read_session...\nfn test_read...");
    assert_eq!(metadata.len(), 0);
    let ContentBlock::ToolResult{ id, value, metadata } = &session.messages[2].content[2] else {
        panic!("session.messages[2].content[2] not toolcall");
    };
    assert_eq!(id, "tool-call-id-2");
    assert_eq!(value, "use std::collections::{HashMap, BinaryHeap};...\n...");
    assert_eq!(metadata.len(), 0);

    let Some((request_config, message_id)) = &request_config else {
        panic!("session.request_config not some");
    };
    assert_eq!(message_id, &4);
    assert_eq!(request_config.model.as_deref(), Some("deepseek-v4-pro"));
    assert_matches!(request_config.thinking, Thinking::Switch(true));
    assert_eq!(request_config.tool_names, vec!["read-file".to_string()]);
}

#[test]
fn test_write() {
    use chrono::Utc;
    use chrono::TimeZone;

    assert_eq!(serde_yaml_ng::to_string(&Message {
        id: 3,
        parent_id: Some(2),
        role: Role::Assistant,
        content: vec![
            ContentBlock::Thinking{
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
        ],
        request_config: Some(RequestConfig {
            base_url: None,
            model: None,
            title: true,
            thinking: Thinking::Effort("high"),
            tool_names: vec!["tool1".to_string(), "tool2".to_string()],
            max_tokens: None,
        }),
        response_metadata: Some(ResponseMetadata{
            start_time: Utc.with_ymd_and_hms(2026, 10, 31, 12, 33, 0).unwrap(),
            complete_time: Utc.with_ymd_and_hms(2026, 10, 31, 12, 35, 0).unwrap(),
            status_code: 200,
            headers: vec![("x-ds-trace-id".to_string(), "x-ds-trace-id-1".to_string())],
            model: "deepseek-flasher".to_string(),
            provider_message_id: "their-message-id".to_string(),
            stop_reason: "tool_use".to_string(),
            usage: r#"{"input_tokens":400,"cache_read_input_tokens":0,"output_tokens":40}"#.to_string(),
            additional: Vec::new(),
        }),
    }).expect("failed to serialize"), vec![
        "assistant 3>2:",
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
        "    title: true",
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
        "    provider-message-id: their-message-id",
        "    stop-reason: tool_use",
        r#"    usage: '{"input_tokens":400,"cache_read_input_tokens":0,"output_tokens":40}'"#, "",
    ].join("\n"));

    assert_eq!(serde_yaml_ng::to_string(&Message {
        id: 5,
        parent_id: Some(42),
        role: Role::Assistant,
        content: vec![ContentBlock::Text{ name: None, value: "this file contains...\nand this file...".to_string() }],
        request_config: None,
        response_metadata: None,
    }).expect("failed to serialize"), vec![
        "assistant 5>42:",
        // what's this |-
        // compare to |, |- means remove trailing new line
        "  content:",
        "  - kind: text",
        "    value: |-",
        "      this file contains...",
        "      and this file...", "",
    ].join("\n"));

    assert_eq!(serde_yaml_ng::to_string(&Message {
        id: 5,
        parent_id: Some(42),
        role: Role::Assistant,
        content: vec![
            ContentBlock::Thinking{ value: "this file contains...\nand this file...\n".to_string(), signature: "signature value".to_string() }
        ],
        request_config: None,
        response_metadata: None,
    }).expect("failed to serialize"), vec![
        "assistant 5>42:",
        "  content:",
        "  - kind: think",
        "    value: |-",
        "      this file contains...",
        "      and this file...",
        "    whitespace: '[[1,\"\\n\"]]'",
        "    signature: signature value", "",
    ].join("\n"));
}

#[test]
fn test_basic_compression() {
    let input = "hello  \nworld\t\nno_trailing";
    let (compressed, map) = side_load_trailing_whitespaces(input);

    assert_eq!(compressed, "hello\nworld\nno_trailing");
    assert_eq!(map.len(), 2);
    assert_eq!(map[0], (0, "  ".to_string()));
    assert_eq!(map[1], (1, "\t".to_string()));

    let restored = merge_trailing_whitespace_records(&compressed, map).unwrap();
    assert_eq!(restored, input);
}

#[test]
fn test_trailing_newlines() {
    let input = "line1\n\n\n";
    let (compressed, map) = side_load_trailing_whitespaces(input);

    println!("compressed: {:?}", compressed);
    println!("map: {:?}", map);

    let restored = merge_trailing_whitespace_records(&compressed, map).unwrap();
    assert_eq!(restored, input);
}

#[test]
fn test_empty_string() {
    let input = "";
    let (compressed, map) = side_load_trailing_whitespaces(input);
    let restored = merge_trailing_whitespace_records(&compressed, map).unwrap();
    assert_eq!(restored, input);
}
