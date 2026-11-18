use std::fmt;
use chrono::{DateTime, Utc};

// in memory session structure

// you need system in role because you need system message in main message array
// because you need multiple system messages
#[derive(Debug, Clone, Copy)]
pub enum Role {
    System,
    User,
    Assistant,
}
impl Role {
    pub fn is_system(&self) -> bool { matches!(self, Role::System) }
    pub fn is_user(&self) -> bool { matches!(self, Role::User) }
    pub fn is_assistant(&self) -> bool { matches!(self, Role::Assistant) }
    pub fn display(&self) -> &'static str {
        match self { Self::System => "system", Self::User => "user", Self::Assistant => "assistant" }
    }
}

#[derive(Debug)]
pub enum ContentBlock {
    Text{
        // use this to wrap text chunks in xml tag: <name>value</name>
        name: Option<String>,
        value: String,
        // currently designed for different versions of system message, default to true
        active: bool,
    },
    // - if you have learned that thinking content don't need to be sent in message history in
    //   following conversation rounds, it is different in tool call scenario, it is required
    //   for tool use turns to let the model "continue thinking", this also implies all requests
    //   in same tool use turn should use same thinking switch, all enabled or all disabled,
    //   thinking effort is not restricted, you can use low effort for minor requests
    // - signature is required for a/ messages api to validate thinking content is not changed
    //   or made up, it is currently not required for deepseek compatible api, but always save
    //   and send the signature back is simpler and easier to understand
    Thinking {
        value: String,
        signature: String,
    },
    ToolUse{ 
        id: String,
        name: String,
        // the value types in serde_json and serde_yaml_anything are just flexible objects,
        // it's ok to serialize and deserialize between serde_json value type and yaml text,
        // but actually currently it is serializing and deserializing between json text as 
        // yaml string to avoid occupying too many lines with minor values
        input: serde_json::Value,
    },
    ToolResult{
        id: String,
        value: String,
        // tool execution metadata, logs, etc.
        metadata: Vec<(String, serde_json::Value)>,
    },
}
impl ContentBlock {
    pub fn new_text(value: String) -> Self { Self::Text{ name: None, value, active: true } }
    pub fn is_tool_use(&self) -> bool { matches!(self, Self::ToolUse{..}) }
}

#[derive(Debug, Clone, Copy)]
pub enum Thinking {
    Switch(bool),
    // can use static str for known limited values
    Effort(&'static str),
}
// currently you cannot #[default] on the variant and expect default into variant fields
impl Default for Thinking {
    fn default() -> Self {
        Self::Switch(false)
    }
}
impl Thinking {
    fn display(&self) -> &'static str {
        match self {
            Self::Switch(true) => "true",
            Self::Switch(false) => "false",
            Self::Effort(effort) => effort,
        }
    }
}

#[derive(Debug)]
pub struct RequestConfig {
    // message id is part of active request config,
    // is not in request config log in completed message 
    pub message_id: usize,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub thinking: Thinking,
    pub tool_names: Vec<String>,
    // let llm api suggest a title by the way
    pub title: bool,
    pub max_tokens: Option<usize>,
    // - traditional parameters, temperature, top_p, top_k, presence_penalty and frequency_penalty
    //   don't work with thinking mode, actually they are not that useful or respected in nowadays
    //   models even without thinking mode, so not include them here
    // - non traditional parameter tool_choice don't work with thinking mode either, so not include
}

#[derive(Debug)]
pub struct ResponseMetadata {
    pub start_time: DateTime<Utc>,
    pub status_code: usize,
    // include some not constant header values in case they are useful
    pub headers: Vec<(String, String)>,
    // response stream complete time
    pub complete_time: DateTime<Utc>,
    pub model: String,
    // returned message object have a guid id
    pub provider_message_id: String,
    pub stop_reason: String,
    // save json text here, currently no need to parse them precisely, actually
    // you can use postgresql's rich json functionality to query values if need
    pub usage: String,
    // additional information if need
    pub additional: Vec<(String, serde_json::Value)>,
}

#[derive(Debug)]
pub struct Message {
    pub id: usize,
    pub parent_id: Option<usize>,
    pub role: Role,
    pub content: Vec<ContentBlock>,
    // only in assistant message, the request config to create this message
    pub request_config: Option<RequestConfig>,
    // only in assistant message, the response metadata of the response to create this message
    pub response_metadata: Option<ResponseMetadata>,
}

#[derive(Debug)]
pub struct Session {
    pub name: String,
    // this is a flattened array of message tree structure, items reference parent node by id and parent id
    pub messages: Vec<Message>,
}

pub struct LongText<'a>(pub &'a str);
// display major text chunks by limit length, add ellipsis and replace \n with \n
impl<'a> fmt::Display for LongText<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        // don't directly [..80], that will cut inside code points
        // simple way is to collect chars into string, this non copy approach is counting byte length
        let leading_len = self.0.chars().take(42).fold(0, |acc, c| acc + c.len_utf8());
        let trailing_len = self.0.chars().rev().take(16).fold(0, |acc, c| acc + c.len_utf8());
        // don't forget these 2 lengths will overlap if content is short, in that case, cmp result is >
        if leading_len + trailing_len >= self.0.len() {
            write!(f, "{}", self.0.replace('\n', "\\n"))
        } else {
            write!(f, "{}...({} bytes)...{}", self.0[..leading_len].replace('\n', "\\n"),
                self.0.len() - leading_len - trailing_len, self.0[self.0.len() - trailing_len..].replace('\n', "\\n"))
        }
    }
}

impl fmt::Display for ContentBlock {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContentBlock::Text{ name: Some(name), value, .. } =>
                write!(f, "   text: {}:\n   {}", name, LongText(value)),
            ContentBlock::Text{ value, .. } =>
                write!(f, "   text:\n   {}", LongText(value)),
            ContentBlock::Thinking{ value, .. } =>
                write!(f, "   think:\n   {}", LongText(value)),
            ContentBlock::ToolUse{ id, name, input } =>
                write!(f, "   tool-use: {}:\n   {}({})", id, name, input),
            ContentBlock::ToolResult{ id, value, .. } =>
                write!(f, "   tool-result: {}:\n   {}", id, LongText(value)),
        }
    }
}
impl fmt::Display for RequestConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "request:")?;
        write!(f, "\n   message id: {}", self.message_id)?;
        if let Some(base_url) = &self.base_url { write!(f, "\n   base url: {}", base_url)?; }
        if let Some(model) = &self.model { write!(f, "\n   model: {}", model)?; }
        if self.title { write!(f, "\n   title: true")?; }
        write!(f, "\n   thinking: {}", self.thinking.display())?;
        if !self.tool_names.is_empty() { write!(f, "\n   tool names: [{}]", self.tool_names.join(","))?; }
        if let Some(max_tokens) = self.max_tokens { write!(f, "\n   max tokens: {}", max_tokens)?; }
        Ok(())
    }
}
impl fmt::Display for Session {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "name: {}", self.name)?;
        for message in &self.messages {
            write!(f, "\n{} {}", message.role.display(), message.id)?;
            if let Some(parent_id) = message.parent_id { write!(f, ">{}", parent_id)?; }
            write!(f, ":")?;
            for block in &message.content { write!(f, "\n{}", block)?; }
        }
        Ok(())
    }
}
