#![allow(dead_code)] // TODO

use serde::{Deserialize, Serialize, Serializer};
use serde::ser::SerializeMap as _;

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
pub fn handle_read_file(_input: ReadFileInput) {}

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
        ("max-items", JsonSchema::string("Maximum item count, default to 100.")),
        ("include-file", JsonSchema::bool("Whether include file typed entries in result, also include fifo, socket, etc., default to true.")),
        ("include-directory", JsonSchema::bool("Whether include directory entries in result, default to true.")),
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
    recursive_limit: Option<usize>,
}
pub fn handle_list_directory(_input: ListDirectoryInput) {}

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

static DEF_RUN_COMMAND: ToolDefinition = ToolDefinition {
    name: "run-command",
    description: concat!("Run command line synchronously. The command may be audited by user or other mechanism. ",
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

pub static ALL_TOOLS: &[&ToolDefinition] = &[
    &DEF_READ_FILE,
    &DEF_EDIT_FILE,
    &DEF_LIST_DIRECTORY,
    &DEF_CURRENT_TIME,
    &DEF_RUN_COMMAND,
];

#[cfg(test)]
mod tests {
    use super::*;

    // ATTENTION it's meaningless to always manual adjust to real data change, in that case, disable this case
    #[test]
    fn serialize() {
        let serialized = serde_json::to_string(ALL_TOOLS).expect("failed to serialize");
        println!("{}", serialized);
        let expect = [
            r#"[{"name":"read-file","description":"Read the contents of a file. Can specify a line range to read using start-line and end-line parameter, default to read 400 lines of content start from first line.","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"The path of the file to read."},"start-line":{"type":"integer","description":"Beginning line to read, start from 1, inclusive, default to 1"},"end-line":{"type":"integer","description":"Ending line to read, start from 1, exclusive, default to 400 lines of content after start-line."}},"required":["path"],"additionalProperties":false}}"#,
            
            r#"{"name":"edit-file","description":"Edit contents of a file. Specify a line range to overwrite, range is left inclusive right exclusive, use same value to insert before the line.","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"The path of the file to write."},"start-line":{"type":"integer","description":"Beginning line to overwrite, start from 1, inclusive."},"end-line":{"type":"integer","description":"Ending line to overwrite, start from 1, exclusive."},"content":{"type":"string","description":"new content to overwrite"}},"required":["path","start-line","end-line","content"],"additionalProperties":false}}"#,
            
            r#"{"name":"list-directory","description":"List file system entries in directory.","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"The path of the directory to read, if omitted, use workspace directory."},"max-items":{"type":"string","description":"Maximum item count, default to 100."},"include-file":{"type":"boolean","description":"Whether include file typed entries in result, also include fifo, socket, etc., default to true."},"include-directory":{"type":"boolean","description":"Whether include directory entries in result, default to true."},"recursive-limit":{"type":"integer","description":"Recursive level limit, set positive value to list recursively, set to 0 to disable recursion, default to 0, not recursive."}},"required":[],"additionalProperties":false}}"#,
            
            r#"{"name":"get-current-time","description":"Get current date and time.","input_schema":{"type":"object","properties":{"format":{"type":"string","description":"strftime format specifier, e.g. %Y-%m-%dT%H%M%S%z, default to iso8601"}},"required":[],"additionalProperties":false}}"#,
            
            r#"{"name":"run-command","description":"Run command line synchronously. The command may be audited by user or other mechanism. Output may be error, timeout or truncated if it is too long. Avoid dangerous commands and instruct user to determine and execute manually.","input_schema":{"type":"object","properties":{"command":{"type":"string","description":"The command to run."},"workingDirectory":{"type":"string","description":"Command working directory, default to current workspace."},"shell":{"type":"boolean","description":"Set true to use shell features like pipe, environment variables and home directory."},"description":{"type":"string","description":"Provide a description to use when the agent prompt user for approval or later to diagnostic unexpected errors."}},"required":["command","description"],"additionalProperties":false}}]"#,
        ];
        assert_eq!(serialized, expect.join(","));
    }

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
