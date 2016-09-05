use std::fmt::{ Display, Formatter, Result as FormatResult };
use std::io;

pub enum ConfigError {
    FailOpenFile { inner_error: io::Error },
    FailParse { inner_error: super::xml::reader::Error },
    UnexpectedPath,
    PathNodeNameNotSet,
    TargetsNotExist,
    TargetNotSet,
    TargetNotExist { target_name: String },
}

impl Display for ConfigError {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        match *self {
            ConfigError::FailOpenFile{ ref inner_error } => {
                writeln!(f, "Failed to open config file: {}", inner_error)
            }
            ConfigError::FailParse { ref inner_error } => {
                writeln!(f, "Failed to parse config file: {}", inner_error)
            }
            ConfigError::UnexpectedPath => {
                writeln!(f, "Unexpected path")
            }
            ConfigError::PathNodeNameNotSet => {
                writeln!(f, "Path node name not set")
            }
            ConfigError::TargetNotSet => {
                writeln!(f, "Target not set")
            }
            ConfigError::TargetNotExist { ref target_name } => {
                writeln!(f, "Target not exist: {}", target_name)
            }
            _ => { writeln!(f, "Wait to check other availability") }
        }
    }
}