use std::fmt;
use chrono::{DateTime, Utc};

// in memory session structure

#[derive(Debug, Clone, Copy)]
pub enum Role {
    User,
    Assistant,
}
impl Role {
    pub fn is_user(&self) -> bool { matches!(self, Role::User) }
    pub fn is_assistant(&self) -> bool { matches!(self, Role::Assistant) }
    pub fn display(&self) -> &'static str { match self { Self::User => "user", Self::Assistant => "assistant" } }
}

#[derive(Debug)]
pub enum ContentBlock {
    Text{
        // use this to wrap text chunks in xml tag: <name>value</name>
        name: Option<String>,
        value: String,
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
        // - the value types in serde_json and serde_yaml_anything are just flexible objects,
        //   it's ok to serialize and deserialize between serde_json value type and yaml text
        // - use custom serialize and deserialize functions to inline this in a string
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
        metadata: Vec<(String, serde_json::Value)>,
    },
}

#[derive(Debug)]
pub enum Thinking {
    Switch(bool),
    // can use static str for known limited values
    Effort(&'static str),
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
// currently you cannot #[default] on the variant and expect default into variant fields
impl Default for Thinking {
    fn default() -> Self {
        Self::Switch(false)
    }
}

#[derive(Debug)]
pub struct RequestConfig {
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub thinking: Thinking,
    pub tool_names: Vec<String>,
    // let api suggest a title
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
    // additional information if useful
    // serde_json::Value can be serialized into yaml text if you ask
    pub additional: Vec<(String, serde_json::Value)>,
}

// system message don't have all other properties as user and assitant messages
#[derive(Debug)]
pub struct SystemMessage {
    pub content: Vec<ContentBlock>,
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
    pub system_message: Option<SystemMessage>,
    // this is a flattened array of message tree structure, items reference parent node by id and parent id
    pub messages: Vec<Message>,
}

struct LongText<'a>(&'a str);
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
        writeln!(f, "request:")?;
        if let Some(base_url) = &self.base_url { writeln!(f, "   base url: {}", base_url)?; }
        if let Some(model) = &self.model { writeln!(f, "   model: {}", model)?; }
        if self.title { writeln!(f, "   title: true")?; }
        writeln!(f, "   thinking: {}", self.thinking.display())?;
        if !self.tool_names.is_empty() { writeln!(f, "   tool names: [{}]", self.tool_names.join(","))?; }
        if let Some(max_tokens) = self.max_tokens { writeln!(f, "   max tokens: {}", max_tokens)?; }
        Ok(())
    }
}

impl fmt::Display for Session {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "name: {}", self.name)?;
        if let Some(message) = &self.system_message {
            writeln!(f, "system:")?;
            for block in &message.content { writeln!(f, "{}", block)?; }
        }
        for message in &self.messages {
            writeln!(f, "{} {}>{}:", message.role.display(), message.id, message.parent_id.unwrap_or(0))?;
            for block in &message.content { writeln!(f, "{}", block)?; }
        }
        Ok(())
    }
}
