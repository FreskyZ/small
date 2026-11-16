use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::ops::Not as _;
use anyhow::{Result, bail};
use chrono::{Timelike, Utc};
use clap::Parser as _;
use futures_util::StreamExt;
use reqwest;
use serde::{Serialize, Deserialize};

mod session;
mod text_repr;
mod sse;
mod handler;
mod llm;

use session::*;
use sse::{ServerSentEvent, EventStreamParser};
use handler::{ToolDefinition, ALL_TOOLS};

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
    tools: Vec<&'static ToolDefinition>,
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

    let unknown_tool_names = request_config.tool_names.iter()
        .map(|n| n.as_str())
        .filter(|n| !ALL_TOOLS.iter().any(|e| &e.name == n)).collect::<Vec<_>>();
    if unknown_tool_names.is_empty().not() {
        bail!("unknown tool names {}", unknown_tool_names.join(","));
    }
    let tools = ALL_TOOLS.iter().filter(|t| request_config.tool_names.iter().any(|n| n == t.name)).map(|t| *t).collect();

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
    fn push(&mut self, event: ServerSentEvent) {
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
    println!("{}", session);
    let Some(request_config) = request_config else { bail!("missing request config, exit"); };
    println!("{}", request_config);

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    let result_message = llm::run(llm::RequestParameters{
        dry: !not_dry,
        api_key,
        session: &session,
        config: request_config,
    }).await?;

    // let request = prepare_request(&session, &request_config, request_message_id)?;
    // println!("{}", get_request_display(&request)?);
    // if !not_dry { println!("this is dry run, use --not-dry to actually run"); return Ok(()); }
    // return Ok(());

    // let client = reqwest::Client::builder().build()?;
    // let request = client
    //     .post(request.url.clone())
    //     .header("content-type", "application/json")
    //     .bearer_auth(api_key)
    //     .json(&request).build()?;
    // // unwrap: provided nanosecond is valid
    // let start_time = Utc::now().with_nanosecond(0).unwrap();
    // let response = client.execute(request).await?;

    // let status = response.status();
    // if !status.is_success() {
    //     let body = response.text().await?;
    //     bail!("response error {}: {}", status, body);
    // }
    // let headers = response.headers();
    // // NOTE that content-type may be "text/event-stream; charset=utf8"
    // // https://www.rfc-editor.org/info/rfc9110/#name-content-type
    // // https://www.rfc-editor.org/info/rfc2046/
    // // ignore no such header, will that happen?
    // if let Some(content_type) = headers.get("content-type") {
    //     // ignore to str error, how does that happen?
    //     if let Ok(content_type) = content_type.to_str() {
    //         // unwrap: split result must have at least 1 element
    //         let content_type_wo_parameters = content_type.split(';').next().unwrap().trim_ascii();
    //         if content_type_wo_parameters != "text/event-stream" {
    //             println!("content-type is not text/event-stream?, {:?}", content_type);
    //         }
    //     }
    // }

    // let mut noticeable_headers = Vec::new();
    // for (name, value) in response.headers() {
    //     // to include unexpected headers, filter by exclude known boring headers
    //     if matches!(name.as_str(),
    //         | "server"
    //         | "vary"
    //         | "access-control-allow-credentials"
    //         | "strict-transport-security"
    //         | "x-content-type-options"
    //         | "cache-control"
    //     ) {
    //         continue;
    //     }
    //     match value.to_str() {
    //         Ok(value) => noticeable_headers.push((name.to_string(), value.to_string())),
    //         Err(error) => noticeable_headers.push((name.to_string(), format!("{:?}: {}", value.as_bytes(), error))),
    //     }
    // }

    // let mut stream = response.bytes_stream();
    // let mut parser = EventStreamParser::new();
    // let mut assembler = <DeltaAssembler>::new();
    // let mut additional = Vec::new();

    // let mut chunks = Vec::new();
    // while let Some(chunk) = stream.next().await {
    //     let Ok(chunk) = chunk else { println!("failed to ? a chunk?"); continue };
    //     chunks.push(String::from_utf8_lossy(chunk.as_ref()).into_owned());
    //     parser.push(chunk);
    //     while let Some(event) = parser.pull()? {
    //         assembler.push(event);
    //     }
    // }
    // assembler.end();

    // // unwrap: provided nanosecond is valid
    // let complete_time = Utc::now().with_nanosecond(0).unwrap();
    // let sse_log = chunks.join("\n");
    // if let Err(error) = fs::write("sse.log", &sse_log) {
    //     eprintln!("failed to write sse.log: {}", error);
    //     eprintln!("{}", sse_log);
    // }
    // if assembler.errors.is_empty().not() {
    //     assembler.errors.iter().for_each(|e| eprintln!("{}", e));
    //     bail!("assembler has errors, abort");
    // }

    // // println!("{:?}", assembler.message);
    // let response_message = assembler.message;
    // // unwrap: session.messages is not empty
    // let result_message_id = session.messages.iter().map(|m| m.id).max().unwrap() + 1;

    // if let Some(title) = response_message.title {
    //     additional.push(("title".to_string(), serde_json::Value::String(title)));
    // }

    // let result_message = Message {
    //     id: result_message_id,
    //     parent_id: Some(request_message_id),
    //     role: Role::Assistant,
    //     request_config: Some(request_config),
    //     response_metadata: Some(ResponseMetadata {
    //         start_time,
    //         status_code: status.as_u16() as usize,
    //         headers: noticeable_headers,
    //         complete_time,
    //         model: response_message.model,
    //         provider_message_id: response_message.id,
    //         // unwrap: stop reason is required in message_delta event
    //         stop_reason: response_message.stop_reason.unwrap(),
    //         usage: response_message.usage.to_string(),
    //         additional,
    //     }),
    //     content: response_message.content.into_iter().map(|block| match block {
    //         RequestContentBlock::Text { text } => ContentBlock::Text{ name: None, value: text },
    //         RequestContentBlock::Think { thinking, signature } => ContentBlock::Thinking{ value: thinking, signature },
    //         RequestContentBlock::ToolUse { id, name, input, .. } => ContentBlock::ToolUse{ id, name, input },
    //         RequestContentBlock::ToolResult {..} => unreachable!("tool-result?"),
    //     }).collect(),
    // };

    let result_message = text_repr::to_string(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    println!("write {}", filename);
    fs::write(&filename, output_content)?;

    Ok(())
}
