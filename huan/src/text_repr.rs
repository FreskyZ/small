use std::fmt;
use serde::{Serialize, Serializer, Deserialize, Deserializer};
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Unexpected};
use serde::de::{Error as DeserializeError, Visitor as DeserializeVisitor};
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

struct ContentBlockVisitor;
impl<'de> DeserializeVisitor<'de> for ContentBlockVisitor {
    type Value = ContentBlock;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("content block")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        let mut results = Vec::new();
        while let Some(element) = seq.next_element::<ContentBlock>()? {
            results.push(element);
        }
        Ok()
    }
}
impl<'de> Deserialize<'de> for ContentBlock {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(ContentBlockVisitor)
    }
}

struct Content {
    blocks: Vec<ContentBlock>,
}
struct ContentVisitor;
impl<'de> DeserializeVisitor<'de> for ContentVisitor {
    type Value = Content;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("message content")
    }
    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> where E: DeserializeError {
        Ok(Content{ blocks: vec![ContentBlock::Text{ name: None, value: v.to_string() }] })
    }
    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error> where A: SeqAccess<'de> {
        let mut results = Vec::new();
        while let Some(element) = seq.next_element::<ContentBlock>()? {
            results.push(element);
        }
        Ok(Content{ blocks: results })
    }
}
impl<'de> Deserialize<'de> for Content {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_any(ContentVisitor)
    }
}

struct MessageVisitor((Role, usize, Option<usize>));
impl MessageVisitor {
    fn from_key(key: &str) -> MessageVisitor {

    }
}
impl<'de> DeserializeVisitor<'de> for MessageVisitor {
    // for system message, return its content in message.content
    type Value = Message;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("message body")
    }
    fn visit_map<A>(self, map: A) -> Result<Self::Value, A::Error> where A: MapAccess<'de> {
        
    }
}
struct MessageSeed {
    seed: (Role, usize, Option<usize>),
}
impl<'de> DeserializeSeed<'de> for MessageSeed {
    type Value = Message;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(MessageVisitor(self.seed))
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
        while let Some(key) = map.next_key::<&str>()? {
            match key {
                "name" => name = Some(map.next_value()?),
                "request" => request_config = Some(map.next_value()?),
            }
        }
        Ok(())
    }
}
impl<'de> Deserialize<'de> for RequestConfigAndId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(RequestConfigVisitor)
    }
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
                "system" => {},
                key if let Some(remain) = key.strip_prefix("user[").or_else(|| key.strip_prefix("assistant[")) => {
                    map.next_value_seed(MessageVisitor{})
                },
                "request" => request_config = Some(map.next_value()?),
            }
        }
        Ok(())
    }
}
impl<'de> Deserialize<'de> for SessionAndRequestConfigAndId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        deserializer.deserialize_map(SessionVisitor)
    }
}

// don't provide intermediate types
pub fn from_str(original_value: &str) -> Result<(Session, Option<(RequestConfig, usize)>)> {

    // and include validate here
    Ok(())
}
