use std::fmt::{ Debug, Formatter, Result as FormatResult };
use std::io;

pub enum Error {
    FailOpenFile { inner_error: io::Error },
    FailParse { inner_error: super::xml::reader::Error },
    UnexpectedPath,
    PathNodeNameNotSet,
    TargetsNotExist,
    TargetNotSet,
    TargetNotExist { target_name: String },
}

impl Debug for Error {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        match *self {
            Error::FailOpenFile{ ref inner_error } => {
                writeln!(f, "Failed to open config file: {}", inner_error)
            }
            Error::FailParse { ref inner_error } => {
                writeln!(f, "Failed to parse config file: {}", inner_error)
            }
            Error::UnexpectedPath => {
                writeln!(f, "Unexpected path")
            }
            Error::PathNodeNameNotSet => {
                writeln!(f, "Path node name not set")
            }
            Error::TargetNotSet => {
                writeln!(f, "Target not set")
            }
            Error::TargetNotExist { ref target_name } => {
                writeln!(f, "Target not exist: {}", target_name)
            }
            _ => { writeln!(f, "Wait to check other availability") }
        }
    }
}