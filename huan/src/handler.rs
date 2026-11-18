#![allow(dead_code)] // TODO
use std::fs;
// ATTENTION this need cfg
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize, Serializer};
use serde::ser::SerializeMap as _;
use crate::session::{ContentBlock, Message, RequestConfig, Role, Session};

// tool definitions and handlers

#[derive(Debug, Serialize)]
pub struct ToolDefinition {
    pub name: &'static str,
    // this is optional, but I guess you should not do that or else the model will imagine a description
    pub description: &'static str,
    // but for now this is plain json value
    input_schema: JsonSchema,
}

// json schema specification https://json-schema.org/specification
// specification repository https://github.com/json-schema-org/json-schema-spec
// is a draft at the time of writing, is unexpectedly not ietf rfc while latest draft came out at 2020
// a 800 star json schema library https://docs.rs/jsonschema include spec definition and validation, has its own derive macro
// a 1.4k star json schema library https://docs.rs/schemars can extract json schema from serde derive definitions

// I guess all strings here are static?
type Str = &'static str;

fn serialize_kv_slice_as_map<S>(value: &&'static [(Str, JsonSchema)], serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
    let mut map = serializer.serialize_map(Some(value.len()))?;
    for (key, value) in *value { map.serialize_entry(key, value)?; }
    map.end()
}
fn default_true() -> bool { true }

// anyof pattern don't use a type
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum JsonSchema {
    Base(JsonSchemaBase),
    AnyOf {
        #[serde(rename = "anyOf")]
        any_of: &'static [JsonSchema],
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum JsonSchemaBase {
    #[serde(rename = "object")]
    Object {
        #[serde(serialize_with = "serialize_kv_slice_as_map")]
        properties: &'static [(Str, JsonSchema)],
        required: &'static [Str],
        #[serde(rename = "additionalProperties")]
        additional_properties: bool,
    },
    #[serde(rename = "string")]
    String {
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<Str>,
        // if you miss this skip, it will result in a "":null in result
        #[serde(skip_serializing_if = "Option::is_none")]
        pattern: Option<Str>,
        // currently support email, hostname, ipv4, ipv6, uuid
        #[serde(skip_serializing_if = "Option::is_none")]
        format: Option<Str>,
    },
    #[serde(rename = "enum")]
    StringLiteral {
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<Str>,
        r#enum: &'static [Str],
    },
    #[serde(rename = "integer")]
    Number {
        description: Option<Str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        r#const: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        minimum: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        maximum: Option<i32>,
        #[serde(rename = "exclusiveMinimum", skip_serializing_if = "Option::is_none")]
        exclusive_minimum: Option<i32>,
        #[serde(rename = "exclusiveMaximum", skip_serializing_if = "Option::is_none")]
        exclusive_maximum: Option<i32>,
        #[serde(rename = "multipleOf", skip_serializing_if = "Option::is_none")]
        multiple_of: Option<i32>,
    },
    #[serde(rename = "boolean")]
    Bool {
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<Str>,
    },
    #[serde(rename = "array")]
    Array {
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<Str>,
        items: &'static JsonSchema,
    },
}

impl JsonSchema {
    const fn object(properties: &'static [(Str, JsonSchema)], required: &'static [Str]) -> Self {
        Self::Base(JsonSchemaBase::Object{ properties, required, additional_properties: false })
    }
    const fn string(desc: &'static str) -> Self {
        Self::Base(JsonSchemaBase::String { description: Some(desc), pattern: None, format: None })
    }
    // if need, the min and max values should be a Range parameter
    const fn number(desc: &'static str) -> Self {
        Self::Base(JsonSchemaBase::Number {
            description: Some(desc),
            r#const: None,
            default: None,
            minimum: None,
            maximum: None,
            exclusive_minimum: None,
            exclusive_maximum: None,
            multiple_of: None,
        })
    }
    const fn bool(desc: &'static str) -> Self {
        Self::Base(JsonSchemaBase::Bool { description: Some(desc) })
    }
    const fn array(desc: &'static str, item: &'static JsonSchema) -> Self {
        Self::Base(JsonSchemaBase::Array { description: Some(desc), items: item })
    }
}

static DEF_READ_FILE: ToolDefinition = ToolDefinition {
    name: "read-file",
    description: "Read the contents of a file. Can specify a line range to read using start-line and end-line parameter, default to read 400 lines of content start from first line.",
    input_schema: JsonSchema::object(&[
        ("path", JsonSchema::string("The path of the file to read.")),
        ("start-line", JsonSchema::number("Beginning line to read, start from 1, inclusive, default to 1")),
        ("end-line", JsonSchema::number("Ending line to read, start from 1, exclusive, default to 400 lines of content after start-line.")),
    ], &["path"]),
};
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ReadFileInput {
    path: String,
    // deserialize will assign None for Option fields, the name "skip_serializing" already tells you it's serializing attribute
    start_line: Option<usize>,
    end_line: Option<usize>,
}
pub fn handle_read_file(workspace: &str, input: ReadFileInput) -> Result<String> {
    let content = fs::read_to_string(Path::new(workspace).join(input.path))?;
    // these start from 1
    match (input.start_line, input.end_line) {
        (None, None) => Ok(content),
        // TODO validate this subtractions
        (None, Some(end_line)) => Ok(content.lines().take(end_line - 1).collect::<Vec<_>>().join("\n")),
        (Some(start_line), None) => Ok(content.lines().skip(start_line - 1).collect::<Vec<_>>().join("\n")),
        (Some(start_line), Some(end_line)) => Ok(content.lines().skip(start_line - 1).take(end_line - start_line).collect::<Vec<_>>().join("\n")),
    }
}

static DEF_EDIT_FILE: ToolDefinition = ToolDefinition {
    name: "edit-file",
    description: "Edit contents of a file. Specify a line range to overwrite, range is left inclusive right exclusive, use same value to insert before the line.",
    input_schema: JsonSchema::object(&[
        ("path", JsonSchema::string("The path of the file to write.")),
        ("start-line", JsonSchema::number("Beginning line to overwrite, start from 1, inclusive.")),
        ("end-line", JsonSchema::number("Ending line to overwrite, start from 1, exclusive.")),
        ("content", JsonSchema::string("new content to overwrite"))
    ], &["path", "start-line", "end-line", "content"]),
};
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct EditFileInput {
    path: String,
    start_line: usize,
    end_line: usize,
    content: String,
}
pub fn handle_edit_file(_input: ReadFileInput) {}

static DEF_LIST_DIRECTORY: ToolDefinition = ToolDefinition{
    name: "list-directory",
    description: "List file system entries in directory.",
    input_schema: JsonSchema::object(&[
        ("path", JsonSchema::string("The path of the directory to read, if omitted, use workspace directory.")),
        ("max-items", JsonSchema::number("Maximum result item count, default to 100.")),
        ("include-file", JsonSchema::bool("Whether include file typed entries in result, also include fifo, socket, etc., default to true.")),
        ("include-directory", JsonSchema::bool("Whether include directory entries in result, default to true.")),
        ("exclude-names", JsonSchema::array("Exclude directory name or file name by exact match, e.g. [\"node_modules\", \".git\"]", &JsonSchema::string(""))),
        ("recursive-limit", JsonSchema::number("Recursive level limit, set positive value to list recursively, set to 0 to disable recursion, default to 0, not recursive.")),
    ], &[]),
};
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ListDirectoryInput {
    path: Option<String>,
    max_items: Option<usize>,
    #[serde(default = "default_true")]
    include_file: bool,
    #[serde(default = "default_true")]
    include_directory: bool,
    #[serde(default)]
    exclude_names: Vec<String>,
    recursive_limit: Option<usize>,
}
fn handle_list_directory(workspace: &str, input: ListDirectoryInput) -> Result<String> {

    let root = match &input.path {
        Some(path) => PathBuf::from(workspace).join(path), // absolute paths replace the base
        None => PathBuf::from(workspace),
    };

    struct ListingState {
        recursive_limit: usize,
        max_items: usize,
        include_file: bool,
        include_directory: bool,
        exclude_names: Vec<String>,
        count: usize,
        lines: Vec<String>,
    }
    let mut state = ListingState {
        recursive_limit: input.recursive_limit.unwrap_or(0),
        max_items: input.max_items.unwrap_or(100),
        include_file: input.include_file,
        include_directory: input.include_directory,
        exclude_names: input.exclude_names,
        count: 0,
        lines: vec![format!("list result of {}:", input.path.as_deref().unwrap_or("."))],
    };
    state.exclude_names.extend(vec!["node_modules".to_string(), ".git".to_string()]);

    fn walk(directory: &Path, depth: usize, state: &mut ListingState) -> Result<()> {

        let mut entries = fs::read_dir(directory)?.filter_map(|e| e.ok()).collect::<Vec<_>>();
        entries.sort_by(|a, b| {
            let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
            b_is_dir.cmp(&a_is_dir).then_with(|| a.file_name().cmp(&b.file_name()))
        });
        for entry in entries {
            if state.count >= state.max_items {
                return Ok(());
            }

            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let included = if is_dir { state.include_directory } else { state.include_file };

            let entry_path = entry.path();
            // exclude if match, ignore this condition if cannot to_str
            let excluded = entry_path.components().any(|c| c.as_os_str().to_str()
                .map(|c| state.exclude_names.iter().any(|e| e == c)).unwrap_or(false));

            if included && !excluded {
                let meta = fs::symlink_metadata(&entry_path)?;
                let kind = if meta.file_type().is_symlink() { 'l' } else if meta.is_dir() { 'd' } else { '-' };
                let mode = meta.permissions().mode() & 0o777;
                let mut permission = String::with_capacity(9);
                for shift in [6u32, 3, 0] {
                    permission.push(if mode & (1 << (shift + 2)) != 0 { 'r' } else { '-' });
                    permission.push(if mode & (1 << (shift + 1)) != 0 { 'w' } else { '-' });
                    permission.push(if mode & (1 << shift) != 0 { 'x' } else { '-' });
                }
                let time = match meta.modified() {
                    Ok(time) => DateTime::<Utc>::from(time).format("%Y-%m-%d %H:%M:%S").to_string(),
                    Err(_) => "-".to_string(),
                };

                // TODO should not be absolute path
                state.lines.push(format!("{kind}{permission} {:>10} {} {}", meta.len(), time, entry_path.display()));
                state.count += 1;
            }
            // DFS: descend immediately after emitting the entry, still respecting the limit.
            if is_dir && depth < state.recursive_limit && state.count < state.max_items {
                walk(&entry.path(), depth + 1, state)?;
            }
        }
        Ok(())
    }
    walk(&root, 0, &mut state)?;

    Ok(state.lines.join("\n"))
}

// #[test]
// fn test_list_directory() {
//     let result = handle_list_directory(".", serde_json::from_str("{\"recursive-limit\":2,\"exclude-names\":[\"target\"]}").expect("failed to parse")).expect("failed to list");
//     println!("{}", result);
//     assert_eq!(result, "");
// }

static DEF_CURRENT_TIME: ToolDefinition = ToolDefinition {
    name: "get-current-time",
    description: "Get current date and time.",
    input_schema: JsonSchema::object(&[
        ("format", JsonSchema::string("strftime format specifier, e.g. %Y-%m-%dT%H%M%S%z, default to iso8601")),
    ], &[]),
};
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct GetCurrentTimeInput {
    format: Option<String>,
}
pub fn handle_get_current_time(_input: GetCurrentTimeInput) {}

// TODO try whitelist shell commands instead of dedicated ls/git/rg/python etc. commands
static DEF_RUN_COMMAND: ToolDefinition = ToolDefinition {
    name: "run-command",
    description: concat!("Run command synchronously. The command may be audited by user or other mechanism. ",
        "Output may be error, timeout or truncated if it is too long. Avoid dangerous commands and instruct user to determine and execute manually."),
    input_schema: JsonSchema::object(&[
        ("command", JsonSchema::string("The command to run.")),
        ("workingDirectory", JsonSchema::string("Command working directory, default to current workspace.")),
        ("shell", JsonSchema::bool("Set true to use shell features like pipe, environment variables and home directory.")),
        ("description", JsonSchema::string("Provide a description to use when the agent prompt user for approval or later to diagnostic unexpected errors.")),
    ], &["command", "description"]),
};
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RunCommandInput {
    command: String,
    working_directory: Option<String>,
    #[serde(default)]
    shell: bool,
    description: String,
}
pub fn handle_run_command(_input: RunCommandInput) {}

static DEF_WEB_SEARCH: ToolDefinition = ToolDefinition {
    name: "web-search",
    description: "Finds web pages for a query and returns summary of contents. There is no budget for a search service right now, I will run the query in browser and collect results.",
    input_schema: JsonSchema::object(&[
        ("query", JsonSchema::string("The search query, support `site:`, negative word like `-advertisement` and exact word `\"exact phrase\"`")),
    ], &["query"]),
};
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct WebSearchInput {
    query: String,
}
pub fn handle_web_search(_input: WebSearchInput) {}

static DEF_WEB_FETCH: ToolDefinition = ToolDefinition {
    name: "web-fetch",
    description: "Retrieves a single web page and returns its main content. There is no budget for a fetch service right now, I will open the page in browser and collect main contents.",
    input_schema: JsonSchema::object(&[
        ("url", JsonSchema::string("The page URL to fetch, an HTTP or HTTPS URL with a host, and must not contain a username or password.")),
    ], &["url"]),
};
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct WebFetchInput {
    url: String,
}
pub fn handle_web_fetch(_input: WebFetchInput) {}

pub static ALL_TOOLS: &[&ToolDefinition] = &[
    &DEF_READ_FILE,
    &DEF_EDIT_FILE,
    &DEF_LIST_DIRECTORY,
    &DEF_CURRENT_TIME,
    &DEF_RUN_COMMAND,
    &DEF_WEB_SEARCH,
    &DEF_WEB_FETCH,
];
pub fn run(workspace: Option<&str>, session: &Session, request_config: RequestConfig) -> Result<Message> {
    let workspace = workspace.unwrap_or(".");
    // unwrap: validated request config message id exist
    let message = session.messages.iter().find(|m| m.id == request_config.message_id).unwrap();

    let mut results = Vec::new();
    for block in &message.content {
        if let ContentBlock::ToolUse { id, name, input } = block {
            match name.as_str() {
                "read-file" => {
                    let input: ReadFileInput = serde_json::from_value(input.clone())?;
                    let input_path = input.path.clone();
                    let output = handle_read_file(&workspace, input)?;
                    println!("read-file: read {} result {}bytes", input_path, output.len());
                    results.push((id, output));
                },
                "list-directory" => {
                    let input: ListDirectoryInput = serde_json::from_value(input.clone())?;
                    let input_path = input.path.clone();
                    let output = handle_list_directory(&workspace, input)?;
                    println!("list-directory: {:?} result {} lines", input_path, output.lines().count());
                    results.push((id, output));
                }
                // only a println or else completed read-file results cannot write to file
                other => println!("{}: not support automatically run yet", other),
            }
        }
    }

    // unwrap: session is not empty
    let result_message_id = session.messages.iter().map(|m| m.id).max().unwrap() + 1;
    Ok(Message {
        id: result_message_id,
        parent_id: Some(message.id),
        role: Role::User,
        content: results.into_iter().map(|(id, content)|
            ContentBlock::ToolResult{ id: id.to_string(), value: content, metadata: Vec::new() }).collect(),
        request_config: None,
        response_metadata: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ATTENTION it's meaningless to always manual adjust to real data change, in that case, disable this case
    // #[test]
    // fn serialize() {
    //     let serialized = serde_json::to_string(ALL_TOOLS).expect("failed to serialize");
    //     println!("{}", serialized);
    //     let expect = [
    //         r#"[{"name":"read-file","description":"Read the contents of a file. Can specify a line range to read using start-line and end-line parameter, default to read 400 lines of content start from first line.","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"The path of the file to read."},"start-line":{"type":"integer","description":"Beginning line to read, start from 1, inclusive, default to 1"},"end-line":{"type":"integer","description":"Ending line to read, start from 1, exclusive, default to 400 lines of content after start-line."}},"required":["path"],"additionalProperties":false}}"#,
            
    //         r#"{"name":"edit-file","description":"Edit contents of a file. Specify a line range to overwrite, range is left inclusive right exclusive, use same value to insert before the line.","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"The path of the file to write."},"start-line":{"type":"integer","description":"Beginning line to overwrite, start from 1, inclusive."},"end-line":{"type":"integer","description":"Ending line to overwrite, start from 1, exclusive."},"content":{"type":"string","description":"new content to overwrite"}},"required":["path","start-line","end-line","content"],"additionalProperties":false}}"#,
            
    //         r#"{"name":"list-directory","description":"List file system entries in directory.","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"The path of the directory to read, if omitted, use workspace directory."},"max-items":{"type":"string","description":"Maximum item count, default to 100."},"include-file":{"type":"boolean","description":"Whether include file typed entries in result, also include fifo, socket, etc., default to true."},"include-directory":{"type":"boolean","description":"Whether include directory entries in result, default to true."},"recursive-limit":{"type":"integer","description":"Recursive level limit, set positive value to list recursively, set to 0 to disable recursion, default to 0, not recursive."}},"required":[],"additionalProperties":false}}"#,
            
    //         r#"{"name":"get-current-time","description":"Get current date and time.","input_schema":{"type":"object","properties":{"format":{"type":"string","description":"strftime format specifier, e.g. %Y-%m-%dT%H%M%S%z, default to iso8601"}},"required":[],"additionalProperties":false}}"#,
            
    //         r#"{"name":"run-command","description":"Run command line synchronously. The command may be audited by user or other mechanism. Output may be error, timeout or truncated if it is too long. Avoid dangerous commands and instruct user to determine and execute manually.","input_schema":{"type":"object","properties":{"command":{"type":"string","description":"The command to run."},"workingDirectory":{"type":"string","description":"Command working directory, default to current workspace."},"shell":{"type":"boolean","description":"Set true to use shell features like pipe, environment variables and home directory."},"description":{"type":"string","description":"Provide a description to use when the agent prompt user for approval or later to diagnostic unexpected errors."}},"required":["command","description"],"additionalProperties":false}}]"#,
    //     ];
    //     assert_eq!(serialized, expect.join(","));
    // }

    #[test]
    fn deserialize() {
        let input: ReadFileInput = serde_json::from_str(r#"{"path":"/data/input.cs"}"#).expect("failed to deserialize");
        assert_eq!(input.path, "/data/input.cs");
        let input: ReadFileInput = serde_json::from_str(r#"{"path":"/data/input.cs","start-line":1,"end-line":42}"#).expect("failed to deserialize");
        assert_eq!(input.path, "/data/input.cs");
        assert_eq!(input.start_line, Some(1));
        assert_eq!(input.end_line, Some(42));
        let input: ListDirectoryInput = serde_json::from_str(r#"{"path":"/data/input.cs"}"#).expect("failed to deserialize");
        assert_eq!(input.path.as_deref(), Some("/data/input.cs"));
        assert_eq!(input.include_file, true);
        assert_eq!(input.include_directory, true);
    }
}
